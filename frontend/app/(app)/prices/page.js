'use client';

// UC40 Tra cứu bảng giá · UC60 Quản lý bảng giá (giá có ngày hiệu lực, giá cũ giữ lại)
import { useState } from 'react';
import { Alert, EmptyRow, Field, Loading, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { ROLE, SERVICE_KIND, fmtDate, todayLocal, vnd } from '@/lib/format';
import { useAction, useApi, useUser } from '@/lib/hooks';

export default function PricesPage() {
  const user = useUser();
  const prices = useApi('/prices');
  const [q, setQ] = useState('');
  const [form, setForm] = useState({ service_id: '', effective_from: todayLocal(), price: '' });
  const action = useAction();
  const isM = user.role === ROLE.manager;
  const rows = (prices.data ?? []).filter((s) => s.name.toLowerCase().includes(q.toLowerCase()) || s.code.toLowerCase().includes(q.toLowerCase()));

  async function submit(e) {
    e.preventDefault();
    const ok = await action.run(() => api('/prices', { method: 'POST', body: form }), 'Đã thêm giá mới');
    if (ok) { setForm({ ...form, price: '' }); prices.reload(); }
  }

  return (
    <>
      <PageHeader title="Bảng giá dịch vụ" subtitle="Giá theo ngày hiệu lực. Hóa đơn đã lập giữ nguyên giá lúc làm." />
      <Alert error={action.error} ok={action.ok} />
      {isM && (
        <form className="card" onSubmit={submit}>
          <h2>Đặt giá mới</h2>
          <div className="form-grid">
            <Field label="Dịch vụ">
              <select value={form.service_id} onChange={(e) => setForm({ ...form, service_id: e.target.value })} required>
                <option value="">— Chọn —</option>
                {prices.data?.filter((s) => s.kind === 'single').map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Áp dụng từ ngày"><input type="date" value={form.effective_from} onChange={(e) => setForm({ ...form, effective_from: e.target.value })} required /></Field>
            <Field label="Giá (₫)"><input type="number" min="0" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required /></Field>
            <button className="btn btn-primary" disabled={action.busy}>Lưu giá</button>
          </div>
        </form>
      )}
      <div className="card"><input placeholder="Tìm dịch vụ…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <Loading state={prices} />
      <div className="card card-tight">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Mã</th><th>Dịch vụ</th><th>Loại</th><th className="num">Giá hiện hành</th><th>Lịch sử giá</th></tr></thead>
            <tbody>
              {rows.length === 0 && <EmptyRow cols={5} />}
              {rows.map((s) => (
                <tr key={s.id}>
                  <td className="muted">{s.code}</td>
                  <td><strong>{s.name}</strong>{!s.is_active && <span className="badge" style={{ marginLeft: 6 }}>Ngừng</span>}</td>
                  <td>{SERVICE_KIND[s.kind]}</td>
                  <td className="num">{s.kind === 'plan' ? <span className="small muted">Chốt theo từng liệu trình</span> : <strong>{vnd(s.current_price)}</strong>}</td>
                  <td className="small">
                    {s.history.length === 0 && <span className="muted">—</span>}
                    {s.history.map((h) => (
                      <div key={h.effective_from} className={h.effective_from > todayLocal() ? '' : 'muted'}>
                        từ {fmtDate(h.effective_from)}: {vnd(h.price)}{h.effective_from > todayLocal() && <span className="badge badge-booked" style={{ marginLeft: 6 }}>Sắp áp dụng</span>}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
