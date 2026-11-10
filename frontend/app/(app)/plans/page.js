'use client';

// Danh sách liệu trình (UC76: liệu trình đang dở, còn mấy buổi)
import Link from 'next/link';
import { useState } from 'react';
import { EmptyRow, Loading, PageHeader, PlanBadge, Progress, Tabs } from '@/components/ui';
import { fmtDate, vnd } from '@/lib/format';
import { useApi } from '@/lib/hooks';

export default function PlansPage() {
  const [status, setStatus] = useState('active');
  const list = useApi(`/plans${status === 'all' ? '' : `?status=${status}`}`);
  return (
    <>
      <PageHeader title="Liệu trình" subtitle="Niềng răng, implant… kéo dài nhiều buổi, tiền trả theo đợt" />
      <Tabs value={status} onChange={setStatus} tabs={[['active', 'Đang điều trị'], ['completed', 'Hoàn tất'], ['cancelled', 'Đã hủy'], ['all', 'Tất cả']]} />
      <Loading state={list} />
      <div className="card card-tight">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Bệnh nhân</th><th>Liệu trình</th><th>BS phụ trách</th><th>Tiến độ</th><th className="num">Còn lại</th><th className="num">Đã thu / Tổng</th><th>Đợt kế tiếp</th><th>Trạng thái</th></tr></thead>
            <tbody>
              {list.data?.length === 0 && <EmptyRow cols={8} />}
              {list.data?.map((p) => (
                <tr key={p.plan_id}>
                  <td><Link href={`/patients/${p.patient_id}`}>{p.patient_name}</Link><div className="small muted">{p.contact_phone}</div></td>
                  <td><Link href={`/plans/${p.plan_id}`}><strong>{p.service_name}</strong></Link></td>
                  <td>{p.doctor_name}</td>
                  <td style={{ minWidth: 150 }}><Progress done={p.sessions_done} total={p.planned_sessions} /></td>
                  <td className="num">{p.sessions_left} buổi</td>
                  <td className="num">{vnd(p.paid)}<div className="small muted">/ {vnd(p.total_price)}</div></td>
                  <td className="small">{p.next_installment ? <>Đợt {p.next_installment.installment_no}: {vnd(p.next_installment.amount)}<br /><span className="muted">hạn {fmtDate(p.next_installment.due_date)}</span></> : '—'}</td>
                  <td><PlanBadge status={p.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
