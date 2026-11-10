'use client';

// UC12 Cập nhật hồ sơ, UC13 Xem lịch sử điều trị
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import PatientForm from '@/components/PatientForm';
import { Alert, EmptyRow, Loading, Modal, PageHeader, PlanBadge, Progress, StatusBadge, Tabs } from '@/components/ui';
import { api } from '@/lib/api';
import { GENDER, ROLE, age, fmtDate, fmtDateTime, vnd } from '@/lib/format';
import { useAction, useApi, useUser } from '@/lib/hooks';

export default function PatientDetailPage() {
  const { id } = useParams();
  const user = useUser();
  const detail = useApi(`/patients/${id}`);
  const [tab, setTab] = useState('appointments');
  const [editing, setEditing] = useState(false);
  const action = useAction();

  if (!detail.data) return <Loading state={detail} />;
  const { patient: p, appointments, records, plans, invoices, samePhone } = detail.data;
  const debt = invoices.reduce((s, i) => s + Math.max(i.remaining, 0), 0);

  async function save(form) {
    const ok = await action.run(() => api(`/patients/${id}`, { method: 'PUT', body: form }), 'Đã lưu hồ sơ');
    if (ok) { setEditing(false); detail.reload(); }
  }

  return (
    <>
      <PageHeader title={p.full_name} subtitle={`Mã BN #${p.id}${p.paper_record_no ? ` · Hồ sơ giấy ${p.paper_record_no}` : ''}`}>
        {user.role !== ROLE.manager && <Link className="btn btn-primary" href={`/appointments/new?patient_id=${p.id}`}>Đặt lịch</Link>}
        {user.role === ROLE.receptionist && <button type="button" className="btn" onClick={() => setEditing(true)}>Sửa hồ sơ</button>}
      </PageHeader>
      <Alert ok={action.ok} />
      {!p.is_active && <Alert warn="Hồ sơ đã ngừng hoạt động (vẫn giữ đủ 5 năm theo luật)." />}
      {p.medical_note && <Alert warn={`Tiền sử / dị ứng: ${p.medical_note}`} />}

      <div className="grid grid-2">
        <div className="card">
          <dl className="kv">
            <dt>Ngày sinh</dt><dd>{p.date_of_birth ? `${fmtDate(p.date_of_birth)} (${age(p.date_of_birth)} tuổi)` : '—'}</dd>
            <dt>Giới tính</dt><dd>{GENDER[p.gender] ?? '—'}</dd>
            <dt>SĐT liên hệ</dt><dd>{p.contact_phone}</dd>
            <dt>Người giám hộ</dt><dd>{p.guardian_name ? `${p.guardian_name} (${p.guardian_relation})` : '—'}</dd>
            <dt>Địa chỉ</dt><dd>{p.address ?? '—'}</dd>
            <dt>Tạo hồ sơ</dt><dd>{fmtDateTime(p.created_at)}</dd>
          </dl>
        </div>
        <div className="card">
          <dl className="kv">
            <dt>Số lượt khám</dt><dd>{records.length}</dd>
            <dt>Khám gần nhất</dt><dd>{fmtDate(records[0]?.appt_date)}</dd>
            <dt>Liệu trình đang dở</dt><dd>{plans.filter((x) => x.status === 'active').length}</dd>
            <dt>Còn nợ</dt><dd>{debt > 0 ? <span className="badge badge-warn">{vnd(debt)}</span> : 'Không'}</dd>
            <dt>Cùng SĐT</dt>
            <dd>{samePhone.length ? samePhone.map((s, i) => <span key={s.id}>{i > 0 && ', '}<Link href={`/patients/${s.id}`}>{s.full_name}</Link></span>) : '—'}</dd>
          </dl>
        </div>
      </div>

      <Tabs value={tab} onChange={setTab} tabs={[
        ['appointments', `Lịch hẹn (${appointments.length})`], ['records', `Phiếu điều trị (${records.length})`],
        ['plans', `Liệu trình (${plans.length})`], ['invoices', `Hóa đơn (${invoices.length})`],
      ]} />

      <div className="card card-tight">
        <div className="table-wrap">
          {tab === 'appointments' && (
            <table className="table">
              <thead><tr><th>Ngày giờ</th><th>Việc</th><th>Bác sĩ · Ghế</th><th>Trạng thái</th><th /></tr></thead>
              <tbody>
                {appointments.length === 0 && <EmptyRow cols={5} />}
                {appointments.map((a) => (
                  <tr key={a.id}>
                    <td className="nowrap"><Link href={`/appointments?date=${a.appt_date}`}>{fmtDate(a.appt_date)} {a.slot_time}</Link></td>
                    <td>{a.service_name}{a.note && <div className="small muted">{a.note}</div>}</td>
                    <td className="small">{a.doctor_name} · {a.chair_name}</td>
                    <td><StatusBadge status={a.status} />{a.cancel_reason && <div className="small muted">{a.cancel_reason}</div>}</td>
                    <td>{a.record_id && <Link href={`/records/${a.record_id}`}>Phiếu</Link>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tab === 'records' && (
            <table className="table">
              <thead><tr><th>Ngày</th><th>Bác sĩ</th><th>Chẩn đoán</th><th>Việc đã làm (răng)</th></tr></thead>
              <tbody>
                {records.length === 0 && <EmptyRow cols={4} />}
                {records.map((r) => (
                  <tr key={r.id}>
                    <td className="nowrap"><Link href={`/records/${r.id}`}>{fmtDate(r.appt_date)} {r.slot_time}</Link></td>
                    <td>{r.doctor_name}</td><td>{r.diagnosis ?? '—'}</td><td>{r.work || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tab === 'plans' && (
            <table className="table">
              <thead><tr><th>Liệu trình</th><th>BS phụ trách</th><th>Tiến độ</th><th className="num">Đã thu / Tổng</th><th>Trạng thái</th></tr></thead>
              <tbody>
                {plans.length === 0 && <EmptyRow cols={5} />}
                {plans.map((x) => (
                  <tr key={x.plan_id}>
                    <td><Link href={`/plans/${x.plan_id}`}>{x.service_name}</Link></td><td>{x.doctor_name}</td>
                    <td style={{ minWidth: 140 }}><Progress done={x.sessions_done} total={x.planned_sessions} /></td>
                    <td className="num">{vnd(x.paid)} / {vnd(x.total_price)}</td><td><PlanBadge status={x.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tab === 'invoices' && (
            <table className="table">
              <thead><tr><th>Hóa đơn</th><th>Ngày lập</th><th>Loại</th><th className="num">Tổng</th><th className="num">Đã thu</th><th className="num">Còn nợ</th></tr></thead>
              <tbody>
                {invoices.length === 0 && <EmptyRow cols={6} />}
                {invoices.map((i) => (
                  <tr key={i.invoice_id}>
                    <td><Link href={`/invoices/${i.invoice_id}`}>#{i.invoice_id}</Link></td><td>{fmtDateTime(i.created_at)}</td>
                    <td>{i.kind === 'visit' ? 'Lượt khám' : 'Đợt liệu trình'}</td>
                    <td className="num">{vnd(i.total)}</td><td className="num">{vnd(i.paid)}</td>
                    <td className="num">{i.remaining > 0 ? <span className="badge badge-warn">{vnd(i.remaining)}</span> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {editing && (
        <Modal title="Sửa hồ sơ bệnh nhân" wide onClose={() => setEditing(false)}>
          <PatientForm initial={p} onSubmit={save} busy={action.busy} error={action.error} />
        </Modal>
      )}
    </>
  );
}
