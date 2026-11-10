// Kiểm thử xác thực & phân quyền API:  cd backend; npm test
// Chạy trên database ở máy (../.env) đã nạp seed.sql + db/migrations. Test tự khởi động app trên cổng ngẫu nhiên,
// mọi thay đổi (mật khẩu, quyền, nhật ký đăng nhập) được trả lại như cũ khi chạy xong.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import app, { API_MOUNTS } from '../src/app.js';
import { LOGIN_LIMIT } from '../src/auth.js';
import { pool } from '../src/db.js';
import { documentedKeys, listRoutes } from '../src/openapi.js';
import { prisma } from '../src/prisma.js';
import { todayLocal } from '../src/validate.js';

const PASSWORD = 'Demo@123';
const startedAt = new Date();
let server;
let base;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  await prisma.login_attempt.deleteMany({ where: { created_at: { gte: startedAt } } });
  await new Promise((resolve) => server.close(resolve));
  await prisma.$disconnect();
  await pool.end();
});

async function call(path, { method = 'GET', token, cookie, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  if (cookie) headers.cookie = cookie;
  const res = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

async function tokenFor(username, password = PASSWORD) {
  const res = await call('/auth/token', { method: 'POST', body: { username, password } });
  assert.equal(res.status, 200, `đăng nhập ${username}: ${JSON.stringify(res.body)}`);
  return res.body.access_token;
}

describe('Tài liệu và khai báo quyền', () => {
  const routes = listRoutes(API_MOUNTS);

  test('mọi route nghiệp vụ đều có authorize(mã quyền)', () => {
    assert.deepEqual(routes.filter((r) => !r.permission).map((r) => `${r.method} ${r.path}`), []);
  });

  test('mọi mã quyền dùng trong code đều có trong bảng permission', async () => {
    const codes = new Set((await prisma.permission.findMany({ select: { code: true } })).map((p) => p.code));
    assert.deepEqual([...new Set(routes.map((r) => r.permission))].filter((c) => !codes.has(c)), []);
  });

  test('mọi route đều có mô tả trong Swagger, spec hợp lệ', async () => {
    const docs = new Set(documentedKeys());
    const missing = routes.map((r) => `${r.method} /api${r.path === '/' ? '' : r.path}`).filter((k) => !docs.has(k));
    assert.deepEqual(missing, []);
    const spec = await call('/openapi.json');
    assert.equal(spec.status, 200);
    assert.equal(spec.body.openapi, '3.1.0');
    const ops = Object.values(spec.body.paths).flatMap((p) => Object.values(p));
    assert.equal(ops.filter((o) => o['x-undocumented']).length, 0);
    assert.deepEqual(spec.body.paths['/api/reports/{key}'].get['x-roles'], ['manager']);
    assert.equal((await fetch(`${base}/docs`)).status, 200);
  });
});

describe('Xác thực', () => {
  test('không có token → 401 kèm WWW-Authenticate', async () => {
    const res = await call('/patients');
    assert.equal(res.status, 401);
    assert.match(res.headers.get('www-authenticate'), /^Bearer/);
  });

  test('token giả / sai chữ ký → 401', async () => {
    assert.equal((await call('/auth/me', { token: 'abc.def.ghi' })).status, 401);
    const real = await tokenFor('lan');
    const forged = `${real.split('.').slice(0, 2).join('.')}.chuky-gia`;
    assert.equal((await call('/auth/me', { token: forged })).status, 401);
  });

  test('POST /auth/token: tên đăng nhập không phân biệt hoa thường, trả Bearer token dùng được', async () => {
    const res = await call('/auth/token', { method: 'POST', body: { username: 'LAN', password: PASSWORD } });
    assert.equal(res.status, 200);
    assert.equal(res.body.token_type, 'Bearer');
    assert.equal(res.body.user.role, 'receptionist');
    const me = await call('/auth/me', { token: res.body.access_token });
    assert.equal(me.status, 200);
    assert.ok(me.body.permissions.includes('invoice.create'));
  });

  test('POST /auth/login: đặt cookie httpOnly, cookie dùng được cho API', async () => {
    const res = await fetch(`${base}/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'hung', password: PASSWORD }),
    });
    assert.equal(res.status, 200);
    const setCookie = res.headers.get('set-cookie');
    assert.match(setCookie, /clinic_token=.+HttpOnly/i);
    const me = await call('/auth/me', { cookie: setCookie.split(';')[0] });
    assert.equal(me.body.username, 'hung');
  });

  test('thời điểm Prisma đọc / ghi khớp đồng hồ DB (phiên UTC, không lệch 7 giờ)', async () => {
    const { rows: [db] } = await pool.query("SELECT current_setting('TimeZone') AS tz, now() AS now");
    assert.equal(db.tz, 'UTC');
    await tokenFor('lan');
    const last = await prisma.login_attempt.findFirst({ where: { username: 'lan' }, orderBy: { id: 'desc' }, select: { created_at: true } });
    assert.ok(Math.abs(last.created_at.getTime() - db.now.getTime()) < 60_000, `lệch ${last.created_at.toISOString()} / ${db.now.toISOString()}`);
  });

  test('sai mật khẩu và tài khoản không có thật trả cùng một thông báo', async () => {
    const wrong = await call('/auth/token', { method: 'POST', body: { username: 'an', password: 'sai-mat-khau-1' } });
    const unknown = await call('/auth/token', { method: 'POST', body: { username: 'khong-co-ai', password: 'sai-mat-khau-1' } });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.body.error, unknown.body.error);
  });

  test(`sai ${LOGIN_LIMIT.perAccountAndIp} lần → 429 có Retry-After, đúng mật khẩu cũng bị chặn`, async () => {
    for (let i = 0; i < LOGIN_LIMIT.perAccountAndIp; i++) {
      assert.equal((await call('/auth/token', { method: 'POST', body: { username: 'hoa', password: `sai-${i}-xyz` } })).status, 401);
    }
    const locked = await call('/auth/token', { method: 'POST', body: { username: 'hoa', password: PASSWORD } });
    assert.equal(locked.status, 429);
    assert.ok(Number(locked.headers.get('retry-after')) > 0);
    const log = await prisma.login_attempt.findMany({ where: { username: 'hoa', created_at: { gte: startedAt } }, orderBy: { id: 'asc' } });
    assert.deepEqual(log.map((a) => a.reason), [...Array(LOGIN_LIMIT.perAccountAndIp).fill('wrong_password'), 'locked']);
    await prisma.login_attempt.deleteMany({ where: { username: 'hoa', created_at: { gte: startedAt } } });
    assert.equal((await call('/auth/token', { method: 'POST', body: { username: 'hoa', password: PASSWORD } })).status, 200);
  });

  test('đổi mật khẩu → token cũ bị từ chối, token mới dùng được; đổi lại như cũ', async () => {
    const oldToken = await tokenFor('binh');
    const weak = await call('/auth/change-password', { method: 'POST', token: oldToken, body: { current_password: PASSWORD, new_password: 'abc' } });
    assert.equal(weak.status, 400);
    const wrongCurrent = await call('/auth/change-password', {
      method: 'POST', token: oldToken, body: { current_password: 'khong-dung-1', new_password: 'MatKhauMoi2026' },
    });
    assert.equal(wrongCurrent.status, 400);

    await new Promise((resolve) => setTimeout(resolve, 1100)); // token cũ phát ở giây trước lúc đổi
    const changed = await call('/auth/change-password', {
      method: 'POST', token: oldToken, body: { current_password: PASSWORD, new_password: 'MatKhauMoi2026' },
    });
    assert.equal(changed.status, 200);
    const rejected = await call('/auth/me', { token: oldToken });
    assert.equal(rejected.status, 401);
    assert.match(rejected.body.error, /Mật khẩu đã được đổi/);
    assert.equal((await call('/auth/me', { token: changed.body.access_token })).status, 200);

    const back = await call('/auth/change-password', {
      method: 'POST', token: changed.body.access_token, body: { current_password: 'MatKhauMoi2026', new_password: PASSWORD },
    });
    assert.equal(back.status, 200);
    await tokenFor('binh');
  });
});

describe('Phân quyền', () => {
  let manager;
  before(async () => { manager = await tokenFor('hung'); });

  test('lễ tân gọi báo cáo → 403 nêu mã quyền, quản lý → 200', async () => {
    const lan = await tokenFor('lan');
    const denied = await call('/reports', { token: lan });
    assert.equal(denied.status, 403);
    assert.match(denied.body.error, /report\.read/);
    assert.equal((await call('/reports', { token: manager })).status, 200);
  });

  test('bác sĩ đặt lịch được nhưng không tiếp nhận khách không hẹn (thiếu appointment.walk_in)', async () => {
    const an = await tokenFor('an');
    const res = await call('/appointments', {
      method: 'POST', token: an,
      body: { patient_id: 1, doctor_id: 2, planned_service_id: 1, appt_date: todayLocal(), slot_time: '19:30', walk_in: true },
    });
    assert.equal(res.status, 403);
    assert.match(res.body.error, /appointment\.walk_in/);
  });

  test('cấp quyền cho vai trò có hiệu lực ngay, thu hồi thì mất quyền', async () => {
    const lan = await tokenFor('lan');
    const before = (await call('/roles', { token: manager })).body.find((r) => r.code === 'receptionist').permissions;
    try {
      const granted = await call('/roles/receptionist/permissions', { method: 'PUT', token: manager, body: { permissions: [...before, 'report.read'] } });
      assert.equal(granted.status, 200);
      assert.deepEqual(granted.body.changes, { added: 1, removed: 0 });
      assert.equal((await call('/reports', { token: lan })).status, 200);
    } finally {
      const restored = await call('/roles/receptionist/permissions', { method: 'PUT', token: manager, body: { permissions: before } });
      assert.equal(restored.status, 200);
    }
    assert.equal((await call('/reports', { token: lan })).status, 403);
  });

  test('không thu hồi được quyền phân quyền của Quản lý; mã quyền lạ bị từ chối', async () => {
    const roles = (await call('/roles', { token: manager })).body;
    const mine = roles.find((r) => r.code === 'manager').permissions;
    const lockout = await call('/roles/manager/permissions', {
      method: 'PUT', token: manager, body: { permissions: mine.filter((c) => c !== 'permission.manage') },
    });
    assert.equal(lockout.status, 409);
    assert.deepEqual((await call('/roles', { token: manager })).body.find((r) => r.code === 'manager').permissions, mine);
    const unknown = await call('/roles/dentist/permissions', { method: 'PUT', token: manager, body: { permissions: ['khong.co'] } });
    assert.equal(unknown.status, 400);
  });

  test('chỉ người có permission.manage mới sửa được quyền', async () => {
    const an = await tokenFor('an');
    const res = await call('/roles/dentist/permissions', { method: 'PUT', token: an, body: { permissions: ['report.read'] } });
    assert.equal(res.status, 403);
  });

  test('nhật ký đăng nhập: quản lý xem được, có lần đăng nhập vừa rồi', async () => {
    const res = await call('/login-attempts?username=hung&limit=5', { token: manager });
    assert.equal(res.status, 200);
    assert.ok(res.body.length > 0);
    assert.equal(res.body[0].username, 'hung');
    assert.equal((await call('/login-attempts', { token: await tokenFor('lan') })).status, 403);
  });
});
