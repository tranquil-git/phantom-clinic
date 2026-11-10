'use client';

// Phân quyền: ma trận mã quyền × vai trò (GET /api/permissions, GET /api/roles, PUT /api/roles/:role/permissions)
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Alert, Loading, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { useAction, useApi, useUser } from '@/lib/hooks';

// Quản lý luôn giữ hai quyền này (API / database cũng chặn)
const LOCKED = { manager: ['permission.read', 'permission.manage'] };

export default function PermissionsPage() {
  const me = useUser();
  const roles = useApi('/roles');
  const permissions = useApi('/permissions');
  const action = useAction();
  const [draft, setDraft] = useState(null); // { role: Set(mã quyền) }
  const canEdit = me.permissions.includes('permission.manage');

  useEffect(() => {
    if (roles.data) setDraft(Object.fromEntries(roles.data.map((r) => [r.code, new Set(r.permissions)])));
  }, [roles.data]);

  const modules = useMemo(() => {
    const groups = new Map();
    for (const p of permissions.data ?? []) groups.set(p.module, [...(groups.get(p.module) ?? []), p]);
    return [...groups];
  }, [permissions.data]);

  const changedRoles = (roles.data ?? []).filter((r) => {
    const now = draft?.[r.code];
    return now && (now.size !== r.permissions.length || r.permissions.some((c) => !now.has(c)));
  });

  function toggle(role, code) {
    setDraft((d) => {
      const next = new Set(d[role]);
      if (next.has(code)) next.delete(code); else next.add(code);
      return { ...d, [role]: next };
    });
  }

  async function save() {
    const ok = await action.run(async () => {
      for (const r of changedRoles) {
        await api(`/roles/${r.code}/permissions`, { method: 'PUT', body: { permissions: [...draft[r.code]] } });
      }
      return true;
    }, `Đã lưu quyền: ${changedRoles.map((r) => r.name).join(', ')}. Nhân viên thấy menu mới khi tải lại trang.`);
    if (ok) { roles.reload(); permissions.reload(); }
  }

  return (
    <>
      <PageHeader title="Phân quyền" subtitle="Vai trò nào được gọi API nào. Đổi quyền có hiệu lực ngay ở thao tác kế tiếp của nhân viên.">
        <a className="btn btn-sm" href="/api/docs" target="_blank" rel="noreferrer">Tài liệu API (Swagger)</a>
      </PageHeader>
      <Alert error={action.error} ok={action.ok} />
      <Loading state={roles} />
      <Loading state={permissions} />
      {draft && permissions.data && (
        <div className="card card-tight">
          <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Mã quyền</th><th>Ý nghĩa</th>
                {roles.data.map((r) => <th key={r.code} className="center">{r.name}<div className="muted">{r.active_staff} người</div></th>)}
              </tr>
            </thead>
            <tbody>
              {modules.map(([module, list]) => (
                <Fragment key={module}>
                  <tr><th colSpan={2 + roles.data.length} className="muted">{module}</th></tr>
                  {list.map((p) => (
                    <tr key={p.code}>
                      <td><code>{p.code}</code></td>
                      <td>{p.description}</td>
                      {roles.data.map((r) => {
                        const locked = LOCKED[r.code]?.includes(p.code);
                        return (
                          <td key={r.code} className="center">
                            <input type="checkbox" aria-label={`${r.name}: ${p.code}`} checked={draft[r.code].has(p.code)}
                              disabled={!canEdit || locked || action.busy} onChange={() => toggle(r.code, p.code)}
                              title={locked ? 'Quản lý luôn giữ quyền này' : undefined} />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
      {canEdit && draft && (
        <div className="row">
          <button type="button" className="btn btn-primary" disabled={!changedRoles.length || action.busy} onClick={save}>
            Lưu thay đổi{changedRoles.length ? ` (${changedRoles.map((r) => r.name).join(', ')})` : ''}
          </button>
          <button type="button" className="btn" disabled={!changedRoles.length || action.busy}
            onClick={() => setDraft(Object.fromEntries(roles.data.map((r) => [r.code, new Set(r.permissions)])))}>
            Hoàn tác
          </button>
        </div>
      )}
    </>
  );
}
