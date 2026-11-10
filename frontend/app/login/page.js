'use client';

// UC01 Đăng nhập
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Alert, Field } from '@/components/ui';
import { api } from '@/lib/api';

function LoginForm() {
  const params = useSearchParams();
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/login', { method: 'POST', body: form });
      const next = params.get('next');
      window.location.href = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form className="card login-card" onSubmit={submit}>
      <h1>Nha khoa Nụ Cười Việt</h1>
      <p className="muted">Đăng nhập dành cho nhân viên phòng khám</p>
      <Alert error={error} />
      <div className="stack">
        <Field label="Tên đăng nhập">
          <input autoFocus autoComplete="username" value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })} required />
        </Field>
        <Field label="Mật khẩu">
          <input type="password" autoComplete="current-password" value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        </Field>
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Đang đăng nhập…' : 'Đăng nhập'}</button>
      </div>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="login-wrap">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
