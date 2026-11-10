'use client';

// UC22 Đặt lịch hẹn (include UC10 tra cứu, UC21 tìm khung trống; extend UC11 tạo hồ sơ) + UC29 khách không hẹn
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { PatientPicker, SlotPicker } from '@/components/appointments';
import { Alert, Field, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { ROLE, fmtDate, todayLocal, vnd, weekday } from '@/lib/format';
import { useAction, useApi, useUser } from '@/lib/hooks';

function BookingInner() {
  const user = useUser();
  const router = useRouter();
  const params = useSearchParams();
  const lookups = useApi('/lookups');
  const [patient, setPatient] = useState(null);
  const [serviceId, setServiceId] = useState('');
  const [doctorId, setDoctorId] = useState(params.get('doctor_id') ?? '');
  const [date, setDate] = useState(params.get('date') ?? todayLocal());
  const [slot, setSlot] = useState(null);
  const [note, setNote] = useState('');
  const [walkIn, setWalkIn] = useState(false);
  const action = useAction();
  const preferredTime = params.get('time');
  const isR = user.role === ROLE.receptionist;

  // Mở từ hồ sơ / phiếu điều trị: ?patient_id=
  useEffect(() => {
    const pid = params.get('patient_id');
    if (pid) api(`/patients/${pid}`).then((d) => setPatient(d.patient)).catch(() => {});
  }, [params]);
  useEffect(() => setSlot(null), [date, doctorId]);
  useEffect(() => { if (walkIn) setDate(todayLocal()); }, [walkIn]);

  if (user.role === ROLE.manager) return <Alert warn="Quản lý không đặt lịch thay lễ tân (GT-16)." />;

  async function submit() {
    const res = await action.run(() => api('/appointments', {
      method: 'POST',
      body: {
        patient_id: patient.id, doctor_id: slot.doctor_id, appt_date: date, slot_time: slot.slot_time,
        planned_service_id: serviceId, note, walk_in: walkIn,
      },
    }));
    if (res) router.push(`/appointments?date=${date}`);
  }

  const service = lookups.data?.services.find((s) => String(s.id) === serviceId);
  return (
    <>
      <PageHeader title="Đặt lịch hẹn" subtitle="Một lịch = 1 bác sĩ + 1 ghế + 1 khung 30 phút; chỉ hiện khung bác sĩ đang trực, còn rảnh và còn ghế" />
      <Alert error={action.error} />

      <div className="card">
        <div className="row-between"><h2>1. Bệnh nhân</h2>
          {isR && !patient && <Link className="btn btn-sm" href="/patients/new?next=booking">+ Hồ sơ mới</Link>}
        </div>
        <PatientPicker value={patient} onChange={setPatient} />
      </div>

      <div className="card">
        <h2>2. Việc cần làm và bác sĩ</h2>
        <div className="form-grid">
          <Field label="Việc cần làm *">
            <select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              <option value="">— Chọn dịch vụ —</option>
              {lookups.data?.services.map((s) => <option key={s.id} value={s.id}>{s.name}{s.price ? ` — ${vnd(s.price)}` : ''}</option>)}
            </select>
          </Field>
          <Field label="Bác sĩ khách muốn">
            <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
              <option value="">Bất kỳ bác sĩ đang trực</option>
              {lookups.data?.doctors.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
            </select>
          </Field>
          <Field label="Ngày" hint={`${weekday(date)} ${fmtDate(date)}`}>
            <input type="date" min={todayLocal()} value={date} disabled={walkIn} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Ghi chú"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
        {isR && (
          <label className="check mt"><input type="checkbox" checked={walkIn} onChange={(e) => setWalkIn(e.target.checked)} /> Khách không hẹn — tiếp đón ngay hôm nay (UC29)</label>
        )}
      </div>

      <div className="card">
        <h2>3. Chọn khung trống {preferredTime && <span className="muted small">(bạn bấm khung {preferredTime} trên lịch)</span>}</h2>
        <SlotPicker date={date} doctorId={doctorId} value={slot} onChange={setSlot} />
      </div>

      <div className="card row-between">
        <div>
          {patient && slot && service
            ? <>Đặt <strong>{patient.full_name}</strong> — {service.name}, <strong>{slot.slot_time} {weekday(date)} {fmtDate(date)}</strong> với {slot.doctor_name}{walkIn && ' — tiếp đón ngay'}</>
            : <span className="muted">Chọn bệnh nhân, việc cần làm và khung giờ.</span>}
        </div>
        <button type="button" className="btn btn-primary" disabled={!patient || !slot || !serviceId || action.busy} onClick={submit}>
          {walkIn ? 'Tiếp nhận và check-in' : 'Đặt lịch'}
        </button>
      </div>
    </>
  );
}

export default function NewAppointmentPage() {
  return <Suspense><BookingInner /></Suspense>;
}
