'use client';

// UC20 xem lịch theo ngày (hàng = khung 30 phút, cột = ghế); UC23 đổi, UC24 hủy, UC27 tiếp đón, UC28 không đến
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { CancelModal, RescheduleModal } from '@/components/appointments';
import { Alert, Field, Loading, Modal, PageHeader, StatusBadge } from '@/components/ui';
import { api, qs } from '@/lib/api';
import { ROLE, addDays, clinicSlots, fmtDate, fmtDateTime, todayLocal, weekday } from '@/lib/format';
import { useAction, useApi, useUser } from '@/lib/hooks';

function AppointmentDetail({ appt, onClose, onChanged, onReschedule, onCancel }) {
  const user = useUser();
  const router = useRouter();
  const action = useAction();
  const today = todayLocal();
  const isR = user.role === ROLE.receptionist;
  const booked = appt.status === 'booked';

  async function post(path, message) {
    const ok = await action.run(() => api(`/appointments/${appt.id}/${path}`, { method: 'POST', body: {} }), message);
    if (ok) onChanged();
  }
  async function startVisit() {
    const rec = await action.run(() => api('/records', { method: 'POST', body: { appointment_id: appt.id } }));
    if (rec) router.push(`/records/${rec.id}`);
  }

  return (
    <Modal title="Lịch hẹn" onClose={onClose} footer={<button type="button" className="btn" onClick={onClose}>Đóng</button>}>
      <Alert error={action.error} ok={action.ok} />
      <dl className="kv">
        <dt>Bệnh nhân</dt><dd><Link href={`/patients/${appt.patient_id}`}>{appt.patient_name}</Link> · {appt.contact_phone}</dd>
        <dt>Thời gian</dt><dd>{appt.slot_time} — {weekday(appt.appt_date)} {fmtDate(appt.appt_date)}</dd>
        <dt>Bác sĩ · Ghế</dt><dd>{appt.doctor_name} · {appt.chair_name}</dd>
        <dt>Việc cần làm</dt><dd>{appt.service_name}</dd>
        <dt>Trạng thái</dt><dd><StatusBadge status={appt.status} />{appt.checked_in_at && <span className="small muted"> lúc {fmtDateTime(appt.checked_in_at)}</span>}</dd>
        {appt.note && <><dt>Ghi chú</dt><dd>{appt.note}</dd></>}
        {appt.status === 'cancelled' && <><dt>Lý do hủy</dt><dd>{appt.cancel_reason}{appt.cancel_note && ` — ${appt.cancel_note}`}<div className="small muted">{appt.cancelled_by_name}, {fmtDateTime(appt.cancelled_at)}</div></dd></>}
      </dl>
      <div className="row mt">
        {isR && booked && appt.appt_date === today && <button type="button" className="btn btn-primary" disabled={action.busy} onClick={() => post('check-in', 'Đã tiếp đón — bệnh nhân vào danh sách chờ khám')}>Tiếp đón (check-in)</button>}
        {isR && booked && appt.appt_date <= today && <button type="button" className="btn" disabled={action.busy} onClick={() => post('no-show', 'Đã đánh dấu không đến')}>Không đến</button>}
        {isR && booked && <button type="button" className="btn" onClick={onReschedule}>Đổi lịch</button>}
        {isR && booked && <button type="button" className="btn btn-danger" onClick={onCancel}>Hủy lịch</button>}
        {user.role === ROLE.dentist && appt.status === 'checked_in' && !appt.record_id && <button type="button" className="btn btn-primary" disabled={action.busy} onClick={startVisit}>Khám — mở phiếu</button>}
        {appt.record_id && <Link className="btn" href={`/records/${appt.record_id}`}>Xem phiếu điều trị</Link>}
      </div>
    </Modal>
  );
}

function AppointmentsInner() {
  const user = useUser();
  const router = useRouter();
  const params = useSearchParams();
  const [date, setDate] = useState(params.get('date') ?? todayLocal());
  const [doctorId, setDoctorId] = useState(user.role === ROLE.dentist ? String(user.id) : '');
  const [selected, setSelected] = useState(null);
  const [modal, setModal] = useState(null);
  const lookups = useApi('/lookups');
  const list = useApi(`/appointments${qs({ date, doctor_id: doctorId })}`);
  const canBook = user.role !== ROLE.manager && date >= todayLocal();

  const chairs = lookups.data?.chairs ?? [];
  const active = (list.data ?? []).filter((a) => a.status !== 'cancelled');
  const cancelled = (list.data ?? []).filter((a) => a.status === 'cancelled');
  const at = (chairId, time) => active.filter((a) => a.chair_id === chairId && a.slot_time === time);

  function changeDate(d) {
    setDate(d);
    router.replace(`/appointments?date=${d}`);
  }
  function refresh() {
    setSelected(null);
    setModal(null);
    list.reload();
  }

  return (
    <>
      <PageHeader title="Lịch hẹn" subtitle={`${weekday(date)}, ${fmtDate(date)} — ${active.length} lịch, ${cancelled.length} đã hủy`}>
        {canBook && <Link className="btn btn-primary" href={`/appointments/new?date=${date}`}>+ Đặt lịch</Link>}
      </PageHeader>

      <div className="card row">
        <button type="button" className="btn btn-sm" onClick={() => changeDate(addDays(date, -1))}>‹ Hôm trước</button>
        <input type="date" value={date} onChange={(e) => changeDate(e.target.value)} style={{ width: 170 }} />
        <button type="button" className="btn btn-sm" onClick={() => changeDate(todayLocal())}>Hôm nay</button>
        <button type="button" className="btn btn-sm" onClick={() => changeDate(addDays(date, 1))}>Hôm sau ›</button>
        <span className="spacer" />
        <Field label="Bác sĩ">
          <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} style={{ minWidth: 200 }}>
            <option value="">Tất cả bác sĩ</option>
            {lookups.data?.doctors.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
          </select>
        </Field>
      </div>

      <Loading state={list} />
      {chairs.length > 0 && (
        <div className="table-wrap">
          <div className="day-grid" style={{ gridTemplateColumns: `64px repeat(${chairs.length}, minmax(170px, 1fr))` }}>
            <div className="cell head" />
            {chairs.map((c) => <div key={c.id} className="cell head">{c.name}</div>)}
            {clinicSlots(date).map((time) => (
              <div key={time} style={{ display: 'contents' }}>
                <div className="cell time">{time}</div>
                {chairs.map((c) => {
                  const items = at(c.id, time);
                  if (items.length === 0) {
                    return canBook
                      ? <div key={c.id} className="cell free" title="Đặt lịch vào khung này"
                          onClick={() => router.push(`/appointments/new?date=${date}&time=${time}`)} />
                      : <div key={c.id} className="cell" />;
                  }
                  return (
                    <div key={c.id} className="cell">
                      {items.map((a) => (
                        <div key={a.id} className={`appt ${a.status}`} onClick={() => setSelected(a)}>
                          <strong>{a.patient_name}</strong>
                          {a.service_name}<br /><span className="muted">{a.doctor_name}</span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {cancelled.length > 0 && (
        <div className="card card-tight mt">
          <h2>Lịch đã hủy</h2>
          <table className="table">
            <thead><tr><th>Giờ</th><th>Bệnh nhân</th><th>Việc</th><th>Lý do</th><th>Người hủy</th></tr></thead>
            <tbody>
              {cancelled.map((a) => (
                <tr key={a.id} onClick={() => setSelected(a)} style={{ cursor: 'pointer' }}>
                  <td>{a.slot_time}</td><td>{a.patient_name}</td><td>{a.service_name}</td>
                  <td>{a.cancel_reason}{a.cancel_note && <span className="muted"> — {a.cancel_note}</span>}</td>
                  <td className="small">{a.cancelled_by_name}<br /><span className="muted">{fmtDateTime(a.cancelled_at)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && !modal && (
        <AppointmentDetail appt={selected} onClose={() => setSelected(null)} onChanged={refresh}
          onReschedule={() => setModal('reschedule')} onCancel={() => setModal('cancel')} />
      )}
      {selected && modal === 'reschedule' && <RescheduleModal appointment={selected} onClose={() => setModal(null)} onDone={refresh} />}
      {selected && modal === 'cancel' && <CancelModal appointment={selected} onClose={() => setModal(null)} onDone={refresh} />}
    </>
  );
}

export default function AppointmentsPage() {
  return <Suspense><AppointmentsInner /></Suspense>;
}
