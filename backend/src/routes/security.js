// Phân quyền & nhật ký đăng nhập (Prisma)
//   GET  /api/roles                     vai trò + mã quyền đang có
//   GET  /api/permissions               danh mục mã quyền + vai trò đang có quyền đó
//   PUT  /api/roles/:role/permissions   đặt lại toàn bộ quyền của một vai trò
//   GET  /api/login-attempts            nhật ký đăng nhập (lọc theo tài khoản, kết quả)
import { Router } from 'express';
import { ALL_ROLES, authorize } from '../auth.js';
import { HttpError } from '../errors.js';
import { prisma, toId } from '../prisma.js';

export const securityRouter = Router();

async function rolesView(where = {}) {
  const [roles, staff] = await Promise.all([
    prisma.role.findMany({
      where,
      orderBy: { code: 'asc' },
      select: {
        code: true,
        name: true,
        description: true,
        role_permission_role_permission_roleTorole: { select: { permission_code: true }, orderBy: { permission_code: 'asc' } },
      },
    }),
    prisma.staff.groupBy({ by: ['role'], where: { is_active: true }, _count: { _all: true } }),
  ]);
  return roles.map((r) => ({
    code: r.code,
    name: r.name,
    description: r.description,
    active_staff: staff.find((s) => s.role === r.code)?._count._all ?? 0,
    permissions: r.role_permission_role_permission_roleTorole.map((p) => p.permission_code),
  }));
}

securityRouter.get('/roles', authorize('permission.read'), async (req, res) => {
  res.json(await rolesView());
});

securityRouter.get('/permissions', authorize('permission.read'), async (req, res) => {
  const rows = await prisma.permission.findMany({
    orderBy: [{ module: 'asc' }, { code: 'asc' }],
    select: { code: true, module: true, description: true, role_permission: { select: { role: true } } },
  });
  res.json(rows.map((p) => ({
    code: p.code,
    module: p.module,
    description: p.description,
    roles: ALL_ROLES.filter((role) => p.role_permission.some((g) => g.role === role)),
  })));
});

// Đặt lại toàn bộ quyền của vai trò (gửi đủ danh sách mong muốn). Có hiệu lực ngay request kế tiếp.
// Quản lý luôn giữ permission.read / permission.manage (trigger role_permission_keep_admin chặn thu hồi).
securityRouter.put('/roles/:role/permissions', authorize('permission.manage'), async (req, res) => {
  const { role } = req.params;
  if (!ALL_ROLES.includes(role)) throw new HttpError(404, 'Không có vai trò này');
  const list = req.body?.permissions;
  if (!Array.isArray(list) || list.some((c) => typeof c !== 'string')) {
    throw new HttpError(400, 'permissions phải là mảng mã quyền, ví dụ ["patient.read", "patient.write"]');
  }
  const wanted = [...new Set(list)];
  const known = new Set((await prisma.permission.findMany({ where: { code: { in: wanted } }, select: { code: true } }))
    .map((p) => p.code));
  const unknown = wanted.filter((c) => !known.has(c));
  if (unknown.length) throw new HttpError(400, `Mã quyền không tồn tại: ${unknown.join(', ')}`);

  const changes = await prisma.$transaction(async (tx) => {
    const removed = await tx.role_permission.deleteMany({ where: { role, permission_code: { notIn: wanted } } });
    const added = await tx.role_permission.createMany({
      data: wanted.map((code) => ({ role, permission_code: code, granted_by: BigInt(req.user.id) })),
      skipDuplicates: true,
    });
    return { added: added.count, removed: removed.count };
  });
  const [view] = await rolesView({ code: role });
  res.json({ ...view, changes });
});

securityRouter.get('/login-attempts', authorize('staff.manage'), async (req, res) => {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 200);
  const where = {};
  if (req.query.username) where.username = String(req.query.username).toLowerCase();
  if (req.query.success === 'true' || req.query.success === 'false') where.success = req.query.success === 'true';
  const rows = await prisma.login_attempt.findMany({
    where,
    orderBy: { created_at: 'desc' },
    take: limit,
    select: {
      id: true, created_at: true, username: true, ip: true, user_agent: true, method: true, success: true, reason: true,
      staff: { select: { full_name: true } },
    },
  });
  res.json(rows.map(({ staff, ...r }) => ({ ...r, id: toId(r.id), staff_name: staff?.full_name ?? null })));
});
