'use client';

// UC45 Chốt két cuối ngày (lễ tân) · UC79 xem đối soát (quản lý)
import Link from 'next/link';
import { useState } from 'react';
import { Alert, EmptyRow, Field, Loading, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { PAY_METHOD, ROLE, fmtDate, fmtDateTime, fmtTime, todayLocal, vnd } from '@/lib/format';
import { useAction, useApi, useUser } from '@/lib/hooks';

export default function CashPage() {
  const user = useUser();
  const [date, setDate] = useState(todayLocal());
  const day = useApi(`/cash-closing?date=${date}`);
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const action = useAction();
  const d = day.data;
  const diff = counted === '' || !d ? null : Number(counted) - d.cash;

  async function close(e) {
    e.preventDefault();
    const ok = await action.run(() => api('/cash-closing', { method: 'POST', body: { closing_date: date, counted_cash: counted, note } }), 'Đã chốt két — các khoản thu của ngày bị khóa sửa');
    if (ok) { setCounted(''); setNote(''); day.reload(); }
  }

  return (
    <>
      <PageHeader title="Chốt két cuối ngày" subtitle="Đối chiếu tiền mặt trong két với các lần thu tiền mặt trong ngày">
        <input type="date" max={todayLocal()} value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 170 }} />
      </PageHeader>
      <Alert error={action.error} ok={action.ok} />
      <Loading state={day} />
      {d && (
        <>
          <div className="grid grid-stats">
            <div className="stat"><div className="label">Tiền mặt theo sổ</div><div className="value">{vnd(d.cash)}</div></div>
            <div className="stat"><div className="label">Chuyển khoản (đối chiếu sao kê)</div><div className="value">{vnd(d.transfer)}</div></div>
            <div className="stat"><div className="label">Số lần thu</div><div className="value">{d.payments.length}</div></div>
            <div className={`stat ${d.closing && d.closing.difference !== 0 ? 'warn' : ''}`}>
              <div className="label">Trạng thái</div><div className="value">{d.closing ? 'Đã chốt' : 'Chưa chốt'}</div>
            </div>
          </div>

          {d.closing ? (
            <div className="card">
              <h2>Kết quả chốt két {fmtDate(d.date)}</h2>
              <dl className="kv">
                <dt>Theo sổ</dt><dd>{vnd(d.closing.expected_cash)}</dd>
                <dt>Đếm được</dt><dd>{vnd(d.closing.counted_cash)}</dd>
                <dt>Chênh lệch</dt><dd><strong>{vnd(d.closing.difference)}</strong></dd>
                {d.closing.note && <><dt>Lý do</dt><dd>{d.closing.note}</dd></>}
                <dt>Người chốt</dt><dd>{d.closing.closed_by_name}, {fmtDateTime(d.closing.closed_at)}</dd>
              </dl>
            </div>
          ) : user.role === ROLE.receptionist && (
            <form className="card" onSubmit={close}>
              <h2>Chốt két</h2>
              <div className="form-grid">
                <Field label="Tiền mặt đếm được trong két (₫)"><input type="number" min="0" value={counted} onChange={(e) => setCounted(e.target.value)} required /></Field>
                <Field label={`Lý do lệch${diff ? ' *' : ''}`}><input value={note} onChange={(e) => setNote(e.target.value)} required={Boolean(diff)} /></Field>
                <button className="btn btn-primary" disabled={action.busy}>Chốt két</button>
              </div>
              {diff !== null && <p className={diff === 0 ? 'small' : 'small'} style={{ color: diff === 0 ? 'var(--ok)' : 'var(--danger)' }}>{diff === 0 ? 'Khớp với sổ.' : `Lệch ${vnd(diff)} so với sổ — phải ghi lý do.`}</p>}
            </form>
          )}

          <div className="card card-tight">
            <h2>Các lần thu trong ngày</h2>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Giờ</th><th>Hóa đơn</th><th>Bệnh nhân</th><th>Hình thức</th><th className="num">Số tiền</th><th>Người thu</th></tr></thead>
                <tbody>
                  {d.payments.length === 0 && <EmptyRow cols={6}>Chưa có lần thu nào</EmptyRow>}
                  {d.payments.map((p) => (
                    <tr key={p.id}>
                      <td>{fmtTime(p.received_at)}</td><td><Link href={`/invoices/${p.invoice_id}`}>#{p.invoice_id}</Link></td>
                      <td>{p.patient_name}</td><td>{PAY_METHOD[p.method]}</td><td className="num">{vnd(p.amount)}</td><td className="small">{p.received_by_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}
