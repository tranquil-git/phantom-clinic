'use client';

// UC61 Xếp ca trực theo ngày (lịch chỉ được xếp vào ca bác sĩ đó trực — LN-11)
import { useState } from 'react';
import { Alert, Field, Loading, Modal, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { addDays, fmtDate, todayLocal, weekday } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';

const WEEKDAYS = [[1, 'T2'], [2, 'T3'], [3, 'T4'], [4, 'T5'], [5, 'T6'], [6, 'T7'], [7, 'CN']];

function mondayOf(d) {
  const dow = new Date(`${d}T00:00:00Z`).getUTCDay() || 7;
  return addDays(d, 1 - dow);
}

export default function ShiftsPage() {
  const [monday, setMonday] = useState(mondayOf(todayLocal()));
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const lookups = useApi('/lookups');
  const shifts = useApi(`/shifts?from=${days[0]}&to=${days[6]}`);
  const action = useAction();
  const [cell, setCell] = useState(null);
  const [bulk, setBulk] = useState({ doctor_id: '', from: days[0], to: addDays(days[0], 27), weekdays: [1, 2, 3, 4, 5, 6], start_time: '08:00', end_time: '20:00' });

  const find = (doctorId, day) => shifts.data?.find((s) => s.doctor_id === doctorId && s.shift_date === day);
  async function save(body, message) {
    const ok = await action.run(() => api('/shifts', { method: 'POST', body }), message);
    if (ok) { setCell(null); shifts.reload(); }
  }
  async function remove(shift) {
    const ok = await action.run(() => api(`/shifts/${shift.id}`, { method: 'DELETE' }), 'Đã xóa ca');
    if (ok !== undefined) { setCell(null); shifts.reload(); }
  }

  return (
    <>
      <PageHeader title="Ca trực bác sĩ" subtitle="Giờ mở cửa 8h–20h, Chủ nhật đến 17h. Không rút / xóa ca khi còn lịch hẹn nằm ngoài ca." />
      <Alert error={action.error} ok={action.ok} />
      <div className="card row">
        <button type="button" className="btn btn-sm" onClick={() => setMonday(addDays(monday, -7))}>‹ Tuần trước</button>
        <strong>{fmtDate(days[0])} – {fmtDate(days[6])}</strong>
        <button type="button" className="btn btn-sm" onClick={() => setMonday(mondayOf(todayLocal()))}>Tuần này</button>
        <button type="button" className="btn btn-sm" onClick={() => setMonday(addDays(monday, 7))}>Tuần sau ›</button>
      </div>
      <Loading state={shifts} />
      <div className="card card-tight">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Bác sĩ</th>{days.map((d) => <th key={d}>{weekday(d)} {fmtDate(d).slice(0, 5)}</th>)}</tr></thead>
            <tbody>
              {lookups.data?.doctors.map((doc) => (
                <tr key={doc.id}>
                  <td><strong>{doc.full_name}</strong></td>
                  {days.map((d) => {
                    const s = find(doc.id, d);
                    return (
                      <td key={d} style={{ cursor: 'pointer' }} onClick={() => setCell({ doctor: doc, day: d, shift: s, start: s?.start_time ?? '08:00', end: s?.end_time ?? (weekday(d) === 'CN' ? '17:00' : '20:00') })}>
                        {s ? <><span className="badge badge-ok">{s.start_time}–{s.end_time}</span>{s.appointment_count > 0 && <div className="small muted">{s.appointment_count} lịch</div>}</> : <span className="muted small">Nghỉ</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <form className="card" onSubmit={(e) => { e.preventDefault(); save(bulk, 'Đã xếp ca'); }}>
        <h2>Xếp ca hàng loạt</h2>
        <div className="form-grid">
          <Field label="Bác sĩ">
            <select value={bulk.doctor_id} onChange={(e) => setBulk({ ...bulk, doctor_id: e.target.value })} required>
              <option value="">— Chọn —</option>
              {lookups.data?.doctors.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
            </select>
          </Field>
          <Field label="Từ ngày"><input type="date" value={bulk.from} onChange={(e) => setBulk({ ...bulk, from: e.target.value })} /></Field>
          <Field label="Đến ngày"><input type="date" value={bulk.to} onChange={(e) => setBulk({ ...bulk, to: e.target.value })} /></Field>
          <Field label="Giờ bắt đầu"><input type="time" step="1800" value={bulk.start_time} onChange={(e) => setBulk({ ...bulk, start_time: e.target.value })} /></Field>
          <Field label="Giờ kết thúc"><input type="time" step="1800" value={bulk.end_time} onChange={(e) => setBulk({ ...bulk, end_time: e.target.value })} /></Field>
        </div>
        <div className="row mt">
          {WEEKDAYS.map(([n, label]) => (
            <label key={n} className="check">
              <input type="checkbox" checked={bulk.weekdays.includes(n)}
                onChange={(e) => setBulk({ ...bulk, weekdays: e.target.checked ? [...bulk.weekdays, n] : bulk.weekdays.filter((x) => x !== n) })} /> {label}
            </label>
          ))}
          <span className="spacer" />
          <button className="btn btn-primary" disabled={action.busy}>Xếp ca</button>
        </div>
        <p className="small muted">Bác sĩ bán thời gian: chỉ chọn các thứ đi làm (ví dụ T2, T4, T6). Ngày đã có ca thì cập nhật giờ.</p>
      </form>

      {cell && (
        <Modal title={`${cell.doctor.full_name} — ${weekday(cell.day)} ${fmtDate(cell.day)}`} onClose={() => setCell(null)} footer={<>
          {cell.shift && <button type="button" className="btn btn-danger" disabled={action.busy} onClick={() => remove(cell.shift)}>Cho nghỉ (xóa ca)</button>}
          <span className="spacer" />
          <button type="button" className="btn" onClick={() => setCell(null)}>Đóng</button>
          <button type="button" className="btn btn-primary" disabled={action.busy}
            onClick={() => save({ doctor_id: cell.doctor.id, from: cell.day, to: cell.day, start_time: cell.start, end_time: cell.end }, 'Đã lưu ca')}>Lưu ca</button>
        </>}>
          <Alert error={action.error} />
          <div className="form-grid">
            <Field label="Bắt đầu"><input type="time" step="1800" value={cell.start} onChange={(e) => setCell({ ...cell, start: e.target.value })} /></Field>
            <Field label="Kết thúc"><input type="time" step="1800" value={cell.end} onChange={(e) => setCell({ ...cell, end: e.target.value })} /></Field>
          </div>
          {cell.shift?.appointment_count > 0 && <p className="small muted mt">Ca này đang có {cell.shift.appointment_count} lịch hẹn.</p>}
        </Modal>
      )}
    </>
  );
}
