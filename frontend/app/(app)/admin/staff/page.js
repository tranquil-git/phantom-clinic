'use client';

// UC63 Quản lý tài khoản nhân viên
import { useState } from 'react';
import { Alert, Field, Loading, Modal, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { ROLE_LABEL, fmtDate } from '@/lib/format';
import { useAction, useApi, useUser } from '@/lib/hooks';

function RoleSelect({ value, onChange }) {
  return (
    <select value={value} onChange={onChange}>
      {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
    </select>
  );
}

export default function StaffPage() {
  const me = useUser();
  const staff = useApi('/staff');
  const action = useAction();
  const [form, setForm] = useState({ full_name: '', phone: '', role: 'receptionist', username: '', password: '' });
  const [edit, setEdit] = useState(null);

  async function create(e) {
    e.preventDefault();
    const ok = await action.run(() => api('/staff', { method: 'POST', body: form }), `Đã tạo tài khoản ${form.username}`);
    if (ok) { setForm({ full_name: '', phone: '', role: 'receptionist', username: '', password: '' }); staff.reload(); }
  }
  async function save() {
    const ok = await action.run(() => api(`/staff/${edit.id}`, { method: 'PATCH', body: edit }), 'Đã lưu tài khoản');
    if (ok) { setEdit(null); staff.reload(); }
  }

  return (
    <>
      <PageHeader title="Nhân viên" subtitle="Tài khoản đăng nhập theo vai trò: lễ tân, bác sĩ, quản lý" />
      <Alert error={action.error} ok={action.ok} />
      <form className="card" onSubmit={create}>
        <h2>Tạo tài khoản</h2>
        <div className="form-grid">
          <Field label="Họ tên"><input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required /></Field>
          <Field label="SĐT"><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <Field label="Vai trò"><RoleSelect value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} /></Field>
          <Field label="Tên đăng nhập"><input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required autoComplete="off" /></Field>
          <Field label="Mật khẩu" hint="8–128 ký tự, có chữ và số"><input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} autoComplete="new-password" /></Field>
          <button className="btn btn-primary" disabled={action.busy}>+ Tạo</button>
        </div>
      </form>
      <Loading state={staff} />
      <div className="card card-tight">
        <table className="table">
          <thead><tr><th>Họ tên</th><th>Vai trò</th><th>Đăng nhập</th><th>SĐT</th><th>Tạo ngày</th><th>Trạng thái</th><th /></tr></thead>
          <tbody>
            {staff.data?.map((s) => (
              <tr key={s.id}>
                <td><strong>{s.full_name}</strong>{s.id === me.id && <span className="muted"> (bạn)</span>}</td><td>{ROLE_LABEL[s.role]}</td>
                <td>{s.username}</td><td>{s.phone ?? '—'}</td><td>{fmtDate(s.created_at?.slice(0, 10))}</td>
                <td>{s.is_active ? <span className="badge badge-ok">Hoạt động</span> : <span className="badge badge-danger">Đã khóa</span>}</td>
                <td className="right"><button type="button" className="btn btn-sm" onClick={() => setEdit({ ...s, phone: s.phone ?? '', password: '' })}>Sửa</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && (
        <Modal title={`Sửa tài khoản ${edit.username}`} onClose={() => setEdit(null)} footer={<>
          <button type="button" className="btn" onClick={() => setEdit(null)}>Đóng</button>
          <button type="button" className="btn btn-primary" disabled={action.busy} onClick={save}>Lưu</button>
        </>}>
          <Alert error={action.error} />
          <div className="form-grid">
            <Field label="Họ tên"><input value={edit.full_name} onChange={(e) => setEdit({ ...edit, full_name: e.target.value })} /></Field>
            <Field label="SĐT"><input value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
            <Field label="Vai trò"><RoleSelect value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })} /></Field>
            <Field label="Mật khẩu mới" hint="để trống nếu không đổi"><input type="password" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} autoComplete="new-password" /></Field>
          </div>
          <label className="check mt"><input type="checkbox" checked={edit.is_active} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} /> Tài khoản đang hoạt động</label>
        </Modal>
      )}
    </>
  );
}
