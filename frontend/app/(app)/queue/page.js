'use client';

// UC30 Danh sách chờ khám (bệnh nhân đã check-in hôm nay)
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, EmptyRow, Loading, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { ROLE, age, fmtDate, fmtTime, todayLocal } from '@/lib/format';
import { useAction, useApi, useUser } from '@/lib/hooks';

export default function QueuePage() {
  const user = useUser();
  const router = useRouter();
  const isD = user.role === ROLE.dentist;
  const [mine, setMine] = useState(isD);
  const queue = useApi(`/queue?date=${todayLocal()}`);
  const action = useAction();
  const rows = (queue.data ?? []).filter((q) => !mine || q.doctor_id === user.id);

  async function start(q) {
    const rec = await action.run(() => api('/records', { method: 'POST', body: { appointment_id: q.appointment_id } }));
    if (rec) router.push(`/records/${rec.id}`);
  }

  return (
    <>
      <PageHeader title="Chờ khám" subtitle={`Bệnh nhân đã tiếp đón hôm nay ${fmtDate(todayLocal())}`}>
        {isD && <label className="check"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Chỉ bệnh nhân của tôi</label>}
        <button type="button" className="btn" onClick={queue.reload}>Làm mới</button>
      </PageHeader>
      <Alert error={action.error} />
      <Loading state={queue} />
      <div className="card card-tight">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Hẹn</th><th>Tiếp đón</th><th>Bệnh nhân</th><th>Việc dự kiến</th><th>Bác sĩ · Ghế</th><th>Trạng thái</th><th /></tr></thead>
            <tbody>
              {rows.length === 0 && <EmptyRow cols={7}>Chưa có bệnh nhân chờ</EmptyRow>}
              {rows.map((q) => (
                <tr key={q.appointment_id}>
                  <td>{q.slot_time}</td>
                  <td className="small">{fmtTime(q.checked_in_at)}</td>
                  <td>
                    <Link href={`/patients/${q.patient_id}`}><strong>{q.patient_name}</strong></Link>
                    {q.date_of_birth && <span className="muted"> · {age(q.date_of_birth)} tuổi</span>}
                    {q.medical_note && <div><span className="badge badge-danger">⚠ {q.medical_note}</span></div>}
                  </td>
                  <td>{q.service_name}</td>
                  <td className="small">{q.doctor_name}<br /><span className="muted">{q.chair_name}</span></td>
                  <td>{q.record_id ? <span className="badge badge-ok">Đã mở phiếu · {q.line_count} việc</span> : <span className="badge badge-booked">Chờ khám</span>}</td>
                  <td className="right">
                    {q.record_id
                      ? <Link className="btn btn-sm" href={`/records/${q.record_id}`}>Mở phiếu</Link>
                      : isD && <button type="button" className="btn btn-sm btn-primary" disabled={action.busy} onClick={() => start(q)}>Khám</button>}
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
