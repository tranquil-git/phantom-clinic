'use client';

// Thu ngân: phiếu chờ lập hóa đơn (UC41), đợt liệu trình chưa lập (UC42), hóa đơn còn nợ (UC44)
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Alert, EmptyRow, Loading, PageHeader, Tabs } from '@/components/ui';
import { api, qs } from '@/lib/api';
import { ROLE, fmtDate, fmtDateTime, todayLocal, vnd } from '@/lib/format';
import { useAction, useApi, useUser } from '@/lib/hooks';

function InvoiceTable({ status }) {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const list = useApi(`/invoices${qs({ status, q: term })}`);
  const total = (list.data ?? []).reduce((s, i) => s + i.remaining, 0);
  return (
    <>
      <div className="card"><input placeholder="Lọc theo SĐT hoặc tên…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <Loading state={list} />
      <div className="card card-tight">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Hóa đơn</th><th>Ngày lập</th><th>Bệnh nhân</th><th>Loại</th><th className="num">Tổng</th><th className="num">Đã thu</th><th className="num">Còn nợ</th></tr></thead>
            <tbody>
              {list.data?.length === 0 && <EmptyRow cols={7} />}
              {list.data?.map((i) => (
                <tr key={i.invoice_id}>
                  <td><Link href={`/invoices/${i.invoice_id}`}><strong>#{i.invoice_id}</strong></Link></td>
                  <td className="small">{fmtDateTime(i.created_at)}</td>
                  <td><Link href={`/patients/${i.patient_id}`}>{i.patient_name}</Link><div className="small muted">{i.contact_phone}</div></td>
                  <td>{i.kind === 'visit' ? 'Lượt khám' : 'Đợt liệu trình'}</td>
                  <td className="num">{vnd(i.total)}</td><td className="num">{vnd(i.paid)}</td>
                  <td className="num">{i.remaining > 0 ? <strong>{vnd(i.remaining)}</strong> : '—'}</td>
                </tr>
              ))}
            </tbody>
            {status === 'unpaid' && list.data?.length > 0 && <tfoot><tr><td colSpan={6}>Tổng còn nợ</td><td className="num">{vnd(total)}</td></tr></tfoot>}
          </table>
        </div>
      </div>
    </>
  );
}

function BillingInner() {
  const user = useUser();
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') ?? 'pending');
  const pending = useApi(tab === 'pending' ? '/billing/pending' : null);
  const action = useAction();
  const isR = user.role === ROLE.receptionist;

  async function invoiceInstallment(i) {
    const res = await action.run(() => api('/invoices/installment', { method: 'POST', body: { installment_id: i.installment_id } }));
    if (res) router.push(`/invoices/${res.id}`);
  }

  return (
    <>
      <PageHeader title="Hóa đơn" subtitle="Giá lấy tự động theo ngày khám — không tra Excel, không cộng tay" />
      <Tabs value={tab} onChange={setTab} tabs={[['pending', 'Chờ lập hóa đơn'], ['unpaid', 'Còn nợ'], ['paid', 'Đã thanh toán'], ['all', 'Tất cả']]} />
      <Alert error={action.error} />
      {tab === 'pending' && (
        <>
          <Loading state={pending} />
          <div className="card card-tight">
            <h2>Phiếu điều trị chờ thanh toán</h2>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Ngày khám</th><th>Bệnh nhân</th><th>Bác sĩ</th><th className="num">Số dòng tính tiền</th><th /></tr></thead>
                <tbody>
                  {pending.data?.records.length === 0 && <EmptyRow cols={5}>Không có phiếu chờ</EmptyRow>}
                  {pending.data?.records.map((r) => (
                    <tr key={r.record_id}>
                      <td className="nowrap">{fmtDate(r.appt_date)} {r.slot_time}</td>
                      <td><Link href={`/patients/${r.patient_id}`}>{r.patient_name}</Link><div className="small muted">{r.contact_phone}</div></td>
                      <td>{r.doctor_name}</td><td className="num">{r.line_count}</td>
                      <td className="right nowrap">
                        <Link className="btn btn-sm" href={`/records/${r.record_id}`}>Phiếu</Link>{' '}
                        {isR && <Link className="btn btn-sm btn-primary" href={`/billing/new/${r.record_id}`}>Lập hóa đơn</Link>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card card-tight">
            <h2>Đợt liệu trình chưa lập hóa đơn</h2>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Hạn</th><th>Bệnh nhân</th><th>Liệu trình</th><th>Đợt</th><th className="num">Số tiền</th><th /></tr></thead>
                <tbody>
                  {pending.data?.installments.length === 0 && <EmptyRow cols={6}>Không có đợt nào</EmptyRow>}
                  {pending.data?.installments.map((i) => (
                    <tr key={i.installment_id} className={i.due_date <= todayLocal() ? 'highlight' : ''}>
                      <td>{fmtDate(i.due_date)}</td>
                      <td><Link href={`/patients/${i.patient_id}`}>{i.patient_name}</Link></td>
                      <td><Link href={`/plans/${i.plan_id}`}>{i.service_name}</Link></td>
                      <td>Đợt {i.installment_no}</td><td className="num">{vnd(i.amount)}</td>
                      <td className="right">{isR && <button type="button" className="btn btn-sm btn-primary" disabled={action.busy} onClick={() => invoiceInstallment(i)}>Lập hóa đơn đợt</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      {tab !== 'pending' && <InvoiceTable key={tab} status={tab} />}
    </>
  );
}

export default function BillingPage() {
  return <Suspense><BillingInner /></Suspense>;
}
