import crypto from 'node:crypto';
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { queryOne } from './db.js';
import { HttpError } from './errors.js';
import { text } from './validate.js';

export const RECEPTIONIST = 'receptionist';
export const DENTIST = 'dentist';
export const MANAGER = 'manager';
export const ALL_ROLES = [RECEPTIONIST, DENTIST, MANAGER];

const COOKIE = 'clinic_token';
const SECRET = process.env.JWT_SECRET;
if (!SECRET) throw new Error('Thiếu JWT_SECRET trong .env');

// Định dạng lưu: scrypt$<salt base64>$<hash base64>
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

export async function requireAuth(req, res, next) {
  try {
    const { sub } = jwt.verify(req.cookies?.[COOKIE] ?? '', SECRET);
    // Đọc lại từ DB mỗi lần để tài khoản bị khóa / đổi vai trò có hiệu lực ngay
    const user = await queryOne(
      'SELECT id, full_name, role, username FROM staff WHERE id = $1 AND is_active',
      [sub],
    );
    if (!user) throw new Error('inactive');
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Chưa đăng nhập hoặc phiên đã hết hạn' });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return next(new HttpError(403, 'Vai trò của bạn không được làm việc này'));
    }
    next();
  };
}

export const authRouter = Router();

authRouter.post('/login', async (req, res) => {
  const username = text(req.body?.username, 'tên đăng nhập');
  const password = text(req.body?.password, 'mật khẩu');
  const user = await queryOne(
    'SELECT id, full_name, role, username, password_hash, is_active FROM staff WHERE username = $1',
    [username],
  );
  if (!user || !user.is_active || !verifyPassword(password, user.password_hash)) {
    throw new HttpError(401, 'Sai tên đăng nhập hoặc mật khẩu');
  }
  const token = jwt.sign({ sub: user.id }, SECRET, { expiresIn: '12h' });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 12 * 3600 * 1000 });
  res.json({ id: user.id, full_name: user.full_name, role: user.role, username: user.username });
});

authRouter.post('/logout', (req, res) => {
  res.clearCookie(COOKIE, { path: '/' });
  res.status(204).end();
});

authRouter.get('/me', requireAuth, (req, res) => res.json(req.user));
