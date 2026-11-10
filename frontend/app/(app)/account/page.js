'use client';

// Đổi mật khẩu của chính mình (POST /api/auth/change-password). Phiên ở các máy khác bị đăng xuất.
import { useState } from 'react';
import { Alert, Field, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { useAction, useUser } from '@/lib/hooks';

const EMPTY = { current_password: '', new_password: '', confirm: '' };

export default function AccountPage() {
  const me = useUser();
  const action = useAction();
  const [form, setForm] = useState(EMPTY);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    const ok = await action.run(async () => {
      if (form.new_password !== form.confirm) throw new Error('Nhập lại mật khẩu mới chưa khớp');
      await api('/auth/change-password', { method: 'POST', body: { current_password: form.current_password, new_password: form.new_password } });
      return true;
    }, 'Đã đổi mật khẩu. Các phiên đăng nhập khác của bạn đã bị đăng xuất.');
    if (ok) setForm(EMPTY);
  }

  return (
    <>
      <PageHeader title="Đổi mật khẩu" subtitle={`${me.full_name} · ${me.username} · ${me.role_name}`} />
      <Alert error={action.error} ok={action.ok} />
      <form className="card" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Mật khẩu hiện tại">
            <input type="password" value={form.current_password} onChange={set('current_password')} required autoComplete="current-password" />
          </Field>
          <Field label="Mật khẩu mới" hint="8–128 ký tự, có chữ và số, không chứa tên đăng nhập">
            <input type="password" value={form.new_password} onChange={set('new_password')} required minLength={8} maxLength={128} autoComplete="new-password" />
          </Field>
          <Field label="Nhập lại mật khẩu mới">
            <input type="password" value={form.confirm} onChange={set('confirm')} required minLength={8} autoComplete="new-password" />
          </Field>
          <button className="btn btn-primary" disabled={action.busy}>Đổi mật khẩu</button>
        </div>
      </form>
    </>
  );
}
