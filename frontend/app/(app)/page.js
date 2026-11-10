'use client';

import Link from 'next/link';
import { EmptyRow, Loading, PageHeader, StatusBadge } from '@/components/ui';
import { ROLE, fmtDate, num, vnd, weekday } from '@/lib/format';
import { useApi, useUser } from '@/lib/hooks';

function Stat({ label, value, href, warn }) {
  const body = <div className={`stat ${warn ? 'warn' : ''}`}><div className="label">{label}</div><div className="value">{value}</div></div>;
  return href ? <Link href={href} style={{ color: 'inherit', textDecoration: 'none' }}>{body}</Link> : body;
}

export default function DashboardPage() {
  const user = useUser();
  const dash = useApi('/dashboard');
  const d = dash.data;
  const isR = user.role === ROLE.receptionist;
  const isD = user.role === ROLE.dentist;
  const isM = user.role === ROLE.manager;

  return (
    <>
      <PageHeader title="Tổng quan" subtitle={d ? `${weekday(d.today)}, ${fmtDate(d.today)}${isD ? ' — lịch của bạn' : ''}` : ''} />
      <Loading state={dash} />
      {d && (
        <>
          <div className="grid grid-stats">
            <Stat label="Lịch hẹn hôm nay" value={num((d.byStatus.booked ?? 0) + (d.byStatus.checked_in ?? 0) + (d.byStatus.no_show ?? 0))} href="/appointments" />
            <Stat label="Đã tiếp đón" value={num(d.byStatus.checked_in ?? 0)} />
            {(isD || isM) && <Stat label="Đang chờ khám" value={num(d.waiting)} href="/queue" warn={d.waiting > 0} />}
            {(isR || isM) && <Stat label="Phiếu chờ lập hóa đơn" value={num(d.pending_billing)} href="/billing" warn={d.pending_billing > 0} />}
            {isR && <Stat label="Hẹn ngày mai chưa nhắc" value={num(d.reminders_pending)} href="/reminders" warn={d.reminders_pending > 0} />}
            {(isR || isM) && <Stat label="Két hôm nay" value={d.cash_closed ? 'Đã chốt' : 'Chưa chốt'} href="/cash" />}
            {(isR || isM) && <Stat label="Tổng công nợ" value={vnd(d.total_debt)} href={isM ? '/reports?r=debts' : '/billing?tab=unpaid'} />}
            {isM && <Stat label="Doanh thu tháng này" value={vnd(d.month_revenue)} href="/reports" />}
          </div>

          <div className="grid grid-2">
            <div className="card card-tight">
              <h2>Lịch hôm nay</h2>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Giờ</th><th>Bệnh nhân</th><th>Việc</th><th>Bác sĩ · Ghế</th><th>Trạng thái</th></tr></thead>
                  <tbody>
                    {d.upcoming.length === 0 && <EmptyRow cols={5}>Hôm nay chưa có lịch</EmptyRow>}
                    {d.upcoming.map((a) => (
                      <tr key={a.id}>
                        <td>{a.slot_time}</td>
                        <td><Link href={`/patients/${a.patient_id}`}>{a.patient_name}</Link></td>
                        <td>{a.service_name}</td>
                        <td className="small">{a.doctor_name}<br /><span className="muted">{a.chair_name}</span></td>
                        <td><StatusBadge status={a.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {(isM || isD) && (
              <div className="card card-tight">
                <h2>Thuốc / vật tư dưới ngưỡng</h2>
                <table className="table">
                  <thead><tr><th>Tên</th><th className="num">Tồn</th><th className="num">Ngưỡng</th></tr></thead>
                  <tbody>
                    {d.lowStock.length === 0 && <EmptyRow cols={3}>Không có mặt hàng nào sắp hết</EmptyRow>}
                    {d.lowStock.map((s) => (
                      <tr key={s.name} className="highlight"><td>{s.name}</td><td className="num">{num(s.on_hand)} {s.unit}</td><td className="num">{num(s.reorder_threshold)}</td></tr>
                    ))}
                  </tbody>
                </table>
                {isM && <p className="small" style={{ padding: '0 16px 12px' }}><Link href="/inventory">Nhập kho →</Link></p>}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
