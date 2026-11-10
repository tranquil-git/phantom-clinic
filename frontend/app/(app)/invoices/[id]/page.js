'use client';

// Hóa đơn + UC44 Thu tiền (một hóa đơn thu nhiều lần, mỗi lần ghi tiền mặt / chuyển khoản)
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Alert, EmptyRow, Field, Loading, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { PAY_METHOD, ROLE, fmtDateTime, num, vnd } from '@/lib/format';
import { useAction, useApi, useUser } from '@/lib/hooks';

export default function InvoicePage() {
  const { id } = useParams();
  const user = useUser();
  const detail = useApi(`/invoices/${id}`);
  const action = useAction();
  const [pay, setPay] = useState(null);

  if (!detail.data) return <Loading state={detail} />;
  const { invoice: inv, lines, payments } = detail.data;
  const form = pay ?? { amount: inv.remaining, method: 'cash', note: '' };
  const canPay = user.role === ROLE.receptionist && inv.remaining > 0;

  async function submit(e) {
    e.preventDefault();
    const ok = await action.run(() => api(`/invoices/${id}/payments`, { method: 'POST', body: form }), `Đã thu ${vnd(Number(form.amount))}`);
    if (ok) { setPay(null); detail.reload(); }
  }

  return (
    <>
      <PageHeader title={`Hóa đơn #${inv.invoice_id}`}
        subtitle={`${inv.kind === 'visit' ? 'Lượt khám' : `Đợt ${inv.installment_no} liệu trình`} · lập ${fmtDateTime(inv.created_at)} bởi ${inv.created_by_name}`}>
        {inv.record_id && <Link className="btn" href={`/records/${inv.record_id}`}>Phiếu điều trị</Link>}
        {inv.plan_id && <Link className="btn" href={`/plans/${inv.plan_id}`}>Liệu trình</Link>}
        <button type="button" className="btn" onClick={() => window.print()}>In</button>
      </PageHeader>
      <Alert error={action.error} ok={action.ok} />

      <div className="card">
        <div className="row-between">
          <div><strong>Nha khoa Nụ Cười Việt</strong><div className="muted small">Bệnh nhân: {inv.patient_name} · {inv.contact_phone}</div></div>
          <div className="right">
            {inv.remaining > 0 ? <span className="badge badge-warn">Còn nợ {vnd(inv.remaining)}</span> : <span className="badge badge-ok">Đã thanh toán đủ</span>}
          </div>
        </div>
        <div className="table-wrap mt">
          <table className="table">
            <thead><tr><th>Mô tả</th><th>Bác sĩ</th><th className="num">SL</th><th className="num">Đơn giá</th><th className="num">Giảm</th><th className="num">Thành tiền</th></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.description}</td><td className="small">{l.doctor_name ?? '—'}</td><td className="num">{num(l.quantity)}</td>
                  <td className="num">{vnd(l.unit_price)}</td><td className="num">{l.discount_amount ? `−${num(l.discount_amount)}` : '—'}</td>
                  <td className="num">{vnd(l.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={5}>Tổng cộng{inv.total_discount_amount > 0 && <span className="muted small"> (đã giảm {vnd(inv.total_discount_amount)} ở tổng — {inv.discount_reason})</span>}</td><td className="num">{vnd(inv.total)}</td></tr>
              <tr><td colSpan={5}>Đã thu</td><td className="num">{vnd(inv.paid)}</td></tr>
              <tr><td colSpan={5}>Còn nợ</td><td className="num">{vnd(inv.remaining)}</td></tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card card-tight">
          <h2>Các lần thu</h2>
          <table className="table">
            <thead><tr><th>Lúc</th><th>Hình thức</th><th className="num">Số tiền</th><th>Người thu</th></tr></thead>
            <tbody>
              {payments.length === 0 && <EmptyRow cols={4}>Chưa thu lần nào</EmptyRow>}
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="small">{fmtDateTime(p.received_at)}</td><td>{PAY_METHOD[p.method]}</td>
                  <td className="num">{vnd(p.amount)}</td><td className="small">{p.received_by_name}{p.note && <div className="muted">{p.note}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canPay && (
          <form className="card no-print" onSubmit={submit}>
            <h2>Thu tiền</h2>
            <div className="stack">
              <Field label="Số tiền" hint={`còn nợ ${vnd(inv.remaining)}`}>
                <input type="number" min="1" max={inv.remaining} value={form.amount} onChange={(e) => setPay({ ...form, amount: e.target.value })} required />
              </Field>
              <div className="row">
                {Object.entries(PAY_METHOD).map(([k, v]) => (
                  <label key={k} className="check"><input type="radio" name="method" checked={form.method === k} onChange={() => setPay({ ...form, method: k })} /> {v}</label>
                ))}
              </div>
              <Field label="Ghi chú"><input value={form.note} onChange={(e) => setPay({ ...form, note: e.target.value })} /></Field>
              <button className="btn btn-primary" disabled={action.busy}>Ghi nhận thu {vnd(Number(form.amount || 0))}</button>
              <p className="small muted">Trả thiếu thì phần còn lại tự thành nợ của hóa đơn này.</p>
            </div>
          </form>
        )}
      </div>
    </>
  );
}
