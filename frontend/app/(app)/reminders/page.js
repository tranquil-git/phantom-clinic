'use client';

// UC25 Nhắc lịch hẹn (gọi điện, ghi kết quả); UC26 gửi SMS khi không nghe máy
import { useState } from 'react';
import { CancelModal, RescheduleModal } from '@/components/appointments';
import { Alert, EmptyRow, Loading, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { REMINDER_RESULT, addDays, fmtDate, fmtDateTime, todayLocal, weekday } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';

export default function RemindersPage() {
  const [date, setDate] = useState(addDays(todayLocal(), 1));
  const list = useApi(`/reminders?date=${date}`);
  const action = useAction();
  const [modal, setModal] = useState(null);

  async function log(appt, channel, result) {
    const ok = await action.run(() => api('/reminders', { method: 'POST', body: { appointment_id: appt.id, channel, result } }),
      channel === 'sms' ? `Đã gửi SMS nhắc hẹn cho ${appt.patient_name}` : `Đã ghi: ${REMINDER_RESULT[result]} — ${appt.patient_name}`);
    if (!ok) return;
    if (result === 'wants_reschedule') setModal({ type: 'reschedule', appt: { ...appt, appt_date: date } });
    if (result === 'wants_cancel') setModal({ type: 'cancel', appt: { ...appt, appt_date: date } });
    list.reload();
  }
  const done = () => { setModal(null); list.reload(); };

  return (
    <>
      <PageHeader title="Nhắc lịch hẹn" subtitle="Gọi điện từng khách; không nghe máy thì gửi SMS">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 170 }} />
      </PageHeader>
      <Alert error={action.error} ok={action.ok} />
      <Loading state={list} />
      <div className="card card-tight">
        <h2>Lịch {weekday(date)} {fmtDate(date)} — {list.data?.length ?? 0} khách cần nhắc</h2>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Giờ</th><th>Bệnh nhân · SĐT</th><th>Việc · Bác sĩ</th><th>Đã nhắc</th><th>Ghi kết quả</th></tr></thead>
            <tbody>
              {list.data?.length === 0 && <EmptyRow cols={5}>Không có lịch nào cần nhắc</EmptyRow>}
              {list.data?.map((a) => {
                const last = a.reminders.at(-1);
                return (
                  <tr key={a.id}>
                    <td>{a.slot_time}</td>
                    <td><strong>{a.patient_name}</strong><br /><a href={`tel:${a.contact_phone}`}>{a.contact_phone}</a></td>
                    <td>{a.service_name}<br /><span className="small muted">{a.doctor_name} · {a.chair_name}</span></td>
                    <td className="small">
                      {a.reminders.length === 0 && <span className="badge badge-warn">Chưa nhắc</span>}
                      {a.reminders.map((r, i) => (
                        <div key={i}>{REMINDER_RESULT[r.result]} <span className="muted">— {r.by}, {fmtDateTime(r.created_at)}</span></div>
                      ))}
                    </td>
                    <td>
                      <div className="row">
                        <button type="button" className="btn btn-sm" disabled={action.busy} onClick={() => log(a, 'call', 'confirmed')}>Xác nhận</button>
                        <button type="button" className="btn btn-sm" disabled={action.busy} onClick={() => log(a, 'call', 'wants_reschedule')}>Xin đổi</button>
                        <button type="button" className="btn btn-sm" disabled={action.busy} onClick={() => log(a, 'call', 'wants_cancel')}>Xin hủy</button>
                        <button type="button" className="btn btn-sm" disabled={action.busy} onClick={() => log(a, 'call', 'no_answer')}>Không nghe máy</button>
                        {last?.result === 'no_answer' && (
                          <button type="button" className="btn btn-sm btn-primary" disabled={action.busy} onClick={() => log(a, 'sms')}>Gửi SMS</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <p className="small muted">Chưa nối cổng SMS thật: hệ thống ghi nhận tin là đã gửi (GT-06).</p>
      {modal?.type === 'reschedule' && <RescheduleModal appointment={modal.appt} onClose={() => setModal(null)} onDone={done} />}
      {modal?.type === 'cancel' && <CancelModal appointment={modal.appt} onClose={() => setModal(null)} onDone={done} />}
    </>
  );
}
