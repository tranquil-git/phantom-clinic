'use client';

import { useEffect, useState } from 'react';
import { api, qs } from '@/lib/api';
import { age, fmtDate, todayLocal, vnd } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { Alert, Field, Modal } from './ui';

// UC21: khung trống (bác sĩ đang trực + bác sĩ rảnh + còn ghế)
export function SlotPicker({ date, doctorId, exceptId, value, onChange }) {
  const slots = useApi(date ? `/appointments/slots${qs({ date, doctor_id: doctorId, except_id: exceptId })}` : null);
  if (!date) return <p className="muted">Chọn ngày để xem khung trống.</p>;
  if (slots.loading) return <p className="muted">Đang tìm khung trống…</p>;
  if (slots.error) return <Alert error={slots.error} />;
  if (!slots.data?.length) return <Alert warn="Không còn khung trống trong ngày này — thử ngày khác hoặc bác sĩ khác." />;
  return (
    <div className="slot-list">
      {slots.data.map((s) => {
        const selected = value?.slot_time === s.slot_time && value?.doctor_id === s.doctor_id;
        return (
          <button type="button" key={`${s.slot_time}-${s.doctor_id}`} className={`slot ${selected ? 'selected' : ''}`}
            onClick={() => onChange(s)} title={`Còn ${s.free_chairs.length} ghế`}>
            {s.slot_time}{doctorId ? '' : ` · ${s.doctor_name.replace(/^BS\s+/, '')}`}
          </button>
        );
      })}
    </div>
  );
}

// UC24: hủy phải có lý do (LN-10)
export function CancelModal({ appointment, onClose, onDone }) {
  const lookups = useApi('/lookups');
  const [reasonId, setReasonId] = useState('');
  const [note, setNote] = useState('');
  const action = useAction();
  async function submit() {
    const ok = await action.run(() => api(`/appointments/${appointment.id}/cancel`, {
      method: 'POST', body: { cancel_reason_id: reasonId, cancel_note: note },
    }));
    if (ok) onDone();
  }
  return (
    <Modal title="Hủy lịch hẹn" onClose={onClose} footer={<>
      <button type="button" className="btn" onClick={onClose}>Đóng</button>
      <button type="button" className="btn btn-danger" disabled={!reasonId || action.busy} onClick={submit}>Xác nhận hủy</button>
    </>}>
      <p>{appointment.patient_name} — {appointment.slot_time} ngày {fmtDate(appointment.appt_date)}, {appointment.doctor_name}</p>
      <Alert error={action.error} />
      <div className="stack">
        <Field label="Lý do hủy">
          <select value={reasonId} onChange={(e) => setReasonId(e.target.value)}>
            <option value="">— Chọn lý do —</option>
            {lookups.data?.cancelReasons.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
        <Field label="Ghi chú"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <p className="small muted">Hệ thống tự ghi người hủy và thời điểm hủy.</p>
      </div>
    </Modal>
  );
}

// UC23
export function RescheduleModal({ appointment, onClose, onDone }) {
  const lookups = useApi('/lookups');
  const [date, setDate] = useState(appointment.appt_date < todayLocal() ? todayLocal() : appointment.appt_date);
  const [doctorId, setDoctorId] = useState(String(appointment.doctor_id));
  const [slot, setSlot] = useState(null);
  const action = useAction();
  useEffect(() => setSlot(null), [date, doctorId]);
  async function submit() {
    const ok = await action.run(() => api(`/appointments/${appointment.id}/reschedule`, {
      method: 'POST', body: { doctor_id: slot.doctor_id, appt_date: date, slot_time: slot.slot_time },
    }));
    if (ok) onDone();
  }
  return (
    <Modal title="Đổi lịch hẹn" wide onClose={onClose} footer={<>
      <button type="button" className="btn" onClick={onClose}>Đóng</button>
      <button type="button" className="btn btn-primary" disabled={!slot || action.busy} onClick={submit}>Lưu lịch mới</button>
    </>}>
      <p>{appointment.patient_name} — đang hẹn {appointment.slot_time} ngày {fmtDate(appointment.appt_date)}</p>
      <Alert error={action.error} />
      <div className="form-grid">
        <Field label="Ngày mới"><input type="date" min={todayLocal()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Bác sĩ">
          <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
            <option value="">Bất kỳ bác sĩ</option>
            {lookups.data?.doctors.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
          </select>
        </Field>
      </div>
      <h3 className="mt">Khung trống</h3>
      <SlotPicker date={date} doctorId={doctorId} exceptId={appointment.id} value={slot} onChange={setSlot} />
    </Modal>
  );
}

// UC10: tra theo SĐT hoặc tên — một số có thể trả về nhiều người (mục 3.2)
export function PatientPicker({ value, onChange }) {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const results = useApi(term.length >= 2 ? `/patients${qs({ q: term })}` : null);

  if (value) {
    return (
      <div className="row-between card" style={{ marginBottom: 0 }}>
        <div>
          <strong>{value.full_name}</strong> <span className="muted">· {value.contact_phone}</span>
          {value.date_of_birth && <span className="muted"> · {age(value.date_of_birth)} tuổi</span>}
          {value.debt > 0 && <span className="badge badge-warn" style={{ marginLeft: 8 }}>Còn nợ {vnd(value.debt)}</span>}
        </div>
        <button type="button" className="btn btn-sm" onClick={() => onChange(null)}>Chọn người khác</button>
      </div>
    );
  }
  return (
    <div className="stack">
      <input autoFocus placeholder="Nhập SĐT hoặc tên bệnh nhân…" value={q} onChange={(e) => setQ(e.target.value)} />
      {results.data && (
        <div className="table-wrap">
          <table className="table">
            <tbody>
              {results.data.length === 0 && <tr><td className="empty">Không tìm thấy — tạo hồ sơ mới.</td></tr>}
              {results.data.map((p) => (
                <tr key={p.id}>
                  <td><strong>{p.full_name}</strong>{p.guardian_name && <div className="small muted">Giám hộ: {p.guardian_name} ({p.guardian_relation})</div>}</td>
                  <td>{p.contact_phone}</td>
                  <td>{p.date_of_birth ? `${fmtDate(p.date_of_birth)} (${age(p.date_of_birth)} tuổi)` : '—'}</td>
                  <td className="right"><button type="button" className="btn btn-sm btn-primary" onClick={() => onChange(p)}>Chọn</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
