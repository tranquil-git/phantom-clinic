// Xác thực & phân quyền API (dữ liệu qua Prisma)
//   Xác thực: JWT HS256, gửi bằng cookie httpOnly "clinic_token" (website) hoặc header
//             "Authorization: Bearer <token>" (Swagger, Postman, app khác).
//   Phân quyền: mỗi endpoint gắn authorize('<mã quyền>'); vai trò nào có mã quyền nào nằm ở bảng
//             role_permission (sửa qua API /api/roles/:role/permissions, có hiệu lực ngay request sau).
import crypto from 'node:crypto';
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { HttpError } from './errors.js';
import { prisma, toId } from './prisma.js';
import { text } from './validate.js';

// Vai trò vẫn dùng cho quy tắc nghiệp vụ (bác sĩ chỉ sửa phiếu của mình…); quyền gọi API thì theo mã quyền
export const RECEPTIONIST = 'receptionist';
export const DENTIST = 'dentist';
export const MANAGER = 'manager';
export const ALL_ROLES = [RECEPTIONIST, DENTIST, MANAGER];

const COOKIE = 'clinic_token';
export const TOKEN_TTL_SECONDS = 12 * 3600;
const JWT_OPTIONS = { algorithm: 'HS256', issuer: 'phantom-clinic-api', audience: 'phantom-clinic' };
const SECRET = process.env.JWT_SECRET;
if (!SECRET) throw new Error('Thiếu JWT_SECRET trong .env');
if (process.env.NODE_ENV === 'production' && SECRET.length < 32) {
  throw new Error('JWT_SECRET production phải dài ít nhất 32 ký tự');
}
// Production chạy sau HTTPS → cookie Secure. Chạy bản production trên http://127.0.0.1 thì đặt COOKIE_SECURE=false.
const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  secure: (process.env.COOKIE_SECURE ?? String(process.env.NODE_ENV === 'production')) === 'true',
};

// Chặn dò mật khẩu: đếm lần sai trong bảng login_attempt (đúng cả khi API chạy nhiều instance trên Vercel)
export const LOGIN_LIMIT = { windowMinutes: 15, perAccountAndIp: 5, perIp: 50 };

// ---------------------------------------------------------------------
// Mật khẩu: scrypt, lưu dạng scrypt$<salt base64>$<hash base64>
// ---------------------------------------------------------------------
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  const [algo, salt, hash] = String(stored).split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

// Tài khoản không tồn tại vẫn tính scrypt một lần, để thời gian trả lời không lộ tên đăng nhập nào có thật
const DUMMY_HASH = hashPassword(crypto.randomBytes(12).toString('hex'));

export function checkPasswordPolicy(password, username) {
  if (password.length < 8 || password.length > 128) throw new HttpError(400, 'Mật khẩu dài 8–128 ký tự');
  if (!/\p{L}/u.test(password) || !/\d/.test(password)) throw new HttpError(400, 'Mật khẩu phải có cả chữ và số');
  // Tên đăng nhập 1–2 ký tự ("an") thì bỏ qua, nếu không sẽ chặn oan rất nhiều mật khẩu
  if (username?.length >= 3 && password.toLowerCase().includes(username.toLowerCase())) {
    throw new HttpError(400, 'Mật khẩu không được chứa tên đăng nhập');
  }
}

// ---------------------------------------------------------------------
// Người dùng + quyền của vai trò (một truy vấn Prisma)
// ---------------------------------------------------------------------
const USER_SELECT = {
  id: true,
  full_name: true,
  username: true,
  role: true,
  is_active: true,
  password_hash: true,
  password_changed_at: true,
  role_staff_roleTorole: {
    select: {
      name: true,
      role_permission_role_permission_roleTorole: { select: { permission_code: true }, orderBy: { permission_code: 'asc' } },
    },
  },
};

function toUser(row) {
  return {
    id: toId(row.id),
    full_name: row.full_name,
    username: row.username,
    role: row.role,
    role_name: row.role_staff_roleTorole.name,
    permissions: row.role_staff_roleTorole.role_permission_role_permission_roleTorole.map((p) => p.permission_code),
  };
}

function signToken(user) {
  return jwt.sign({ sub: String(user.id), role: user.role }, SECRET, { ...JWT_OPTIONS, expiresIn: TOKEN_TTL_SECONDS });
}

function readToken(req) {
  const header = req.get('authorization');
  if (header) return /^Bearer\s+(\S+)$/i.exec(header)?.[1] ?? '';
  return req.cookies?.[COOKIE] ?? '';
}

function unauthorized(res, message) {
  res.set('WWW-Authenticate', 'Bearer realm="phantom-clinic"');
  return new HttpError(401, message);
}

// Mọi API sau /api (trừ /api/auth/login|token|logout, /api/health, /api/docs) đi qua đây
export async function requireAuth(req, res, next) {
  let payload;
  try {
    payload = jwt.verify(readToken(req), SECRET, { ...JWT_OPTIONS, algorithms: ['HS256'] });
  } catch {
    return next(unauthorized(res, 'Chưa đăng nhập hoặc phiên đã hết hạn'));
  }
  // Đọc lại từ DB mỗi request: khóa tài khoản, đổi vai trò, đổi quyền, đổi mật khẩu có hiệu lực ngay
  const row = /^\d+$/.test(payload.sub ?? '')
    ? await prisma.staff.findUnique({ where: { id: BigInt(payload.sub) }, select: USER_SELECT })
    : null;
  if (!row?.is_active) return next(unauthorized(res, 'Tài khoản không còn hoạt động'));
  if (payload.iat * 1000 < row.password_changed_at.getTime()) {
    return next(unauthorized(res, 'Mật khẩu đã được đổi, hãy đăng nhập lại'));
  }
  req.user = toUser(row);
  req.permissions = new Set(req.user.permissions);
  next();
}

// Middleware phân quyền. Gắn mã quyền vào hàm để src/openapi.js đọc lại khi sinh tài liệu Swagger.
export function authorize(permission) {
  const middleware = (req, res, next) => {
    if (req.permissions?.has(permission)) return next();
    next(new HttpError(403, `Vai trò ${req.user?.role_name ?? ''} không có quyền ${permission}`));
  };
  middleware.permission = permission;
  return middleware;
}

// Kiểm tra quyền bên trong handler (một thao tác phụ của endpoint, ví dụ khách không hẹn)
export const can = (req, permission) => req.permissions?.has(permission) ?? false;

// ---------------------------------------------------------------------
// Đăng nhập (chung cho cookie và Bearer token)
// ---------------------------------------------------------------------
async function assertNotLocked(username, ip) {
  const since = new Date(Date.now() - LOGIN_LIMIT.windowMinutes * 60_000);
  const lastOk = await prisma.login_attempt.findFirst({
    where: { username, ip, success: true, created_at: { gte: since } },
    orderBy: { created_at: 'desc' },
    select: { created_at: true },
  });
  // Lần "locked" không tính, để khóa tự hết sau đúng 15 phút kể từ lần sai cuối
  const failed = { success: false, reason: { not: 'locked' } };
  const [recent, ipFailures] = await Promise.all([
    prisma.login_attempt.findMany({
      where: { username, ip, ...failed, created_at: { gte: lastOk?.created_at ?? since } },
      orderBy: { created_at: 'desc' },
      take: LOGIN_LIMIT.perAccountAndIp,
      select: { created_at: true },
    }),
    prisma.login_attempt.count({ where: { ip, ...failed, created_at: { gte: since } } }),
  ]);
  const accountLocked = recent.length >= LOGIN_LIMIT.perAccountAndIp;
  if (!accountLocked && ipFailures < LOGIN_LIMIT.perIp) return;
  const from = accountLocked ? recent.at(-1).created_at.getTime() : Date.now();
  const retryAfter = Math.max(1, Math.ceil((from + LOGIN_LIMIT.windowMinutes * 60_000 - Date.now()) / 1000));
  throw new HttpError(429, `Sai mật khẩu quá nhiều lần, thử lại sau ${Math.ceil(retryAfter / 60)} phút`, { retryAfter });
}

async function authenticate(req, method) {
  const username = text(req.body?.username, 'tên đăng nhập').toLowerCase();
  const password = text(req.body?.password, 'mật khẩu');
  const attempt = { username, method, ip: req.ip ?? null, user_agent: req.get('user-agent')?.slice(0, 300) ?? null };
  try {
    await assertNotLocked(username, attempt.ip);
  } catch (err) {
    await prisma.login_attempt.create({ data: { ...attempt, success: false, reason: 'locked' } });
    throw err;
  }
  const row = await prisma.staff.findUnique({ where: { username }, select: USER_SELECT });
  const passwordOk = verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
  const reason = !row ? 'unknown_user' : !passwordOk ? 'wrong_password' : !row.is_active ? 'inactive' : null;
  await prisma.login_attempt.create({ data: { ...attempt, staff_id: row?.id ?? null, success: !reason, reason } });
  // Cùng một thông báo cho mọi trường hợp sai, không lộ tài khoản nào có thật / bị khóa
  if (reason) throw new HttpError(401, 'Sai tên đăng nhập hoặc mật khẩu');
  return toUser(row);
}

function setSessionCookie(res, token) {
  res.cookie(COOKIE, token, { ...COOKIE_OPTIONS, maxAge: TOKEN_TTL_SECONDS * 1000 });
}

export const authRouter = Router();

// Website: phiên đăng nhập trong cookie httpOnly (JavaScript trên trang không đọc được token)
authRouter.post('/login', async (req, res) => {
  const user = await authenticate(req, 'cookie');
  setSessionCookie(res, signToken(user));
  res.json(user);
});

// Swagger / Postman / app khác: nhận access token, gửi lại bằng header Authorization: Bearer <token>
authRouter.post('/token', async (req, res) => {
  const user = await authenticate(req, 'token');
  res.json({ access_token: signToken(user), token_type: 'Bearer', expires_in: TOKEN_TTL_SECONDS, user });
});

authRouter.post('/logout', (req, res) => {
  res.clearCookie(COOKIE, COOKIE_OPTIONS);
  res.status(204).end();
});

authRouter.get('/me', requireAuth, (req, res) => res.json(req.user));

// Đổi mật khẩu của chính mình → mọi token / phiên cũ hết hiệu lực, trả phiên mới cho người vừa đổi
authRouter.post('/change-password', requireAuth, async (req, res) => {
  const current = text(req.body?.current_password, 'mật khẩu hiện tại');
  const newPassword = text(req.body?.new_password, 'mật khẩu mới');
  const row = await prisma.staff.findUnique({ where: { id: BigInt(req.user.id) }, select: { password_hash: true } });
  if (!verifyPassword(current, row.password_hash)) throw new HttpError(400, 'Mật khẩu hiện tại không đúng');
  if (current === newPassword) throw new HttpError(400, 'Mật khẩu mới phải khác mật khẩu hiện tại');
  checkPasswordPolicy(newPassword, req.user.username);
  // Tính theo giây như "iat" của JWT: token phát từ giây này trở đi còn dùng được, token cũ thì không
  const changedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
  await prisma.staff.update({
    where: { id: BigInt(req.user.id) },
    data: { password_hash: hashPassword(newPassword), password_changed_at: changedAt },
  });
  const token = signToken(req.user);
  if (req.get('authorization')) {
    return res.json({ message: 'Đã đổi mật khẩu', access_token: token, token_type: 'Bearer', expires_in: TOKEN_TTL_SECONDS });
  }
  setSessionCookie(res, token);
  res.json({ message: 'Đã đổi mật khẩu' });
});
