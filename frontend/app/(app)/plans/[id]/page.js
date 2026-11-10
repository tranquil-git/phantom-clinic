'use client';

// Chi tiết liệu trình: các buổi đã làm, kế hoạch đợt trả (UC42 lập hóa đơn đợt), đổi số buổi / đóng liệu trình
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, EmptyRow, Field, Loading, PageHeader, PlanBadge, Progress } from '@/components/ui';
import { api } from '@/lib/api';
import { PLAN_STATUS, ROLE, fmtDate, fmtDateTime, todayLocal, vnd } from '@/lib/format';
import { useAction, useApi, useUser } from '@/lib/hooks';

export default function PlanDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const user = useUser();
  const detail = useApi(`/plans/${id}`);
  const action = useAction();
  const [form, setForm] = useState(null);

  if (!detail.data) return <Loading state={detail} />;
  const { plan: p, installments, sessions, audit } = detail.data;
  const canEdit = user.role === ROLE.dentist && user.id === p.doctor_id;
  const f = form ?? { planned_sessions: p.planned_sessions, status: p.status, reason: '' };

  async function invoiceInstallment(inst) {
    const res = await action.run(() => api('/invoices/installment', { method: 'POST', body: { installment_id: inst.id } }));
    if (res) router.push(`/invoices/${res.id}`);
  }
  async function save(e) {
    e.preventDefault();
    const ok = await action.run(() => api(`/plans/${id}`, { method: 'PATCH', body: f }), 'Đã cập nhật liệu trình');
    if (ok) { setForm(null); detail.reload(); }
  }

  return (
    <>
      <PageHeader title={`${p.service_name} — ${p.patient_name}`}
        subtitle={`Bắt đầu ${fmtDate(p.started_on)} · BS phụ trách ${p.doctor_name}${p.closed_on ? ` · Đóng ${fmtDate(p.closed_on)}` : ''}`}>
        <PlanBadge status={p.status} />
      </PageHeader>
      <Alert error={action.error} ok={action.ok} />

      <div className="grid grid-stats">
        <div className="stat"><div className="label">Tiến độ</div><div className="value"><Progress done={p.sessions_done} total={p.planned_sessions} /></div></div>
        <div className="stat"><div className="label">Còn lại</div><div className="value">{p.sessions_left} buổi</div></div>
        <div className="stat"><div className="label">Tổng giá</div><div className="value">{vnd(p.total_price)}</div></div>
        <div className="stat"><div className="label">Đã thu</div><div className="value">{vnd(p.paid)}</div></div>
      </div>

      <div className="card card-tight">
        <h2>Kế hoạch đợt trả</h2>
        <table className="table">
          <thead><tr><th>Đợt</th><th className="num">Số tiền</th><th>Hạn</th><th>Hóa đơn</th><th className="num">Đã thu</th><th className="num">Còn nợ</th><th /></tr></thead>
          <tbody>
            {installments.map((i) => (
              <tr key={i.id} className={!i.invoice_id && i.due_date <= todayLocal() ? 'highlight' : ''}>
                <td>Đợt {i.installment_no}</td><td className="num">{vnd(i.amount)}</td><td>{fmtDate(i.due_date)}</td>
                <td>{i.invoice_id ? <Link href={`/invoices/${i.invoice_id}`}>#{i.invoice_id}</Link> : <span className="muted">Chưa lập</span>}</td>
                <td className="num">{i.invoice_id ? vnd(i.paid) : '—'}</td>
                <td className="num">{i.invoice_id ? vnd(i.remaining) : '—'}</td>
                <td className="right">
                  {!i.invoice_id && user.role === ROLE.receptionist && p.status !== 'cancelled' && (
                    <button type="button" className="btn btn-sm btn-primary" disabled={action.busy} onClick={() => invoiceInstallment(i)}>Lập hóa đơn đợt</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card card-tight">
        <h2>Các buổi đã làm</h2>
        <table className="table">
          <thead><tr><th>Buổi</th><th>Ngày</th><th>Bác sĩ</th><th>Việc (răng)</th></tr></thead>
          <tbody>
            {sessions.length === 0 && <EmptyRow cols={4}>Chưa có buổi nào</EmptyRow>}
            {sessions.map((s) => (
              <tr key={`${s.session_no}-${s.record_id}`}>
                <td>Buổi {s.session_no}</td><td><Link href={`/records/${s.record_id}`}>{fmtDate(s.appt_date)}</Link></td>
                <td>{s.doctor_name}</td><td>{s.work}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <form className="card" onSubmit={save}>
          <h2>Điều chỉnh liệu trình</h2>
          <div className="form-grid">
            <Field label="Số buổi dự kiến"><input type="number" min="1" value={f.planned_sessions} onChange={(e) => setForm({ ...f, planned_sessions: e.target.value })} /></Field>
            <Field label="Trạng thái">
              <select value={f.status} onChange={(e) => setForm({ ...f, status: e.target.value })}>
                {Object.entries(PLAN_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Lý do" hint="ghi vào lịch sử"><input value={f.reason} onChange={(e) => setForm({ ...f, reason: e.target.value })} /></Field>
            <button className="btn btn-primary" disabled={action.busy || form === null}>Lưu</button>
          </div>
        </form>
      )}

      <div className="card card-tight">
        <h2>Lịch sử điều chỉnh</h2>
        <table className="table">
          <thead><tr><th>Lúc</th><th>Người</th><th>Thay đổi</th><th>Lý do</th></tr></thead>
          <tbody>
            {audit.length === 0 && <EmptyRow cols={4}>Chưa điều chỉnh</EmptyRow>}
            {audit.map((a, i) => (
              <tr key={i}>
                <td className="small nowrap">{fmtDateTime(a.changed_at)}</td><td>{a.changed_by_name}</td>
                <td className="small">
                  {['planned_sessions', 'status'].filter((k) => a.old_data?.[k] !== a.new_data?.[k])
                    .map((k) => `${k === 'status' ? 'Trạng thái' : 'Số buổi'}: ${PLAN_STATUS[a.old_data[k]] ?? a.old_data[k]} → ${PLAN_STATUS[a.new_data[k]] ?? a.new_data[k]}`).join('; ')}
                </td>
                <td>{a.reason ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
