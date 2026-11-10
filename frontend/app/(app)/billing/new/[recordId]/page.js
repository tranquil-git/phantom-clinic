'use client';

// UC41 Lập hóa đơn lượt khám + UC43 Áp dụng giảm giá (theo dòng và / hoặc ở tổng)
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Field, Loading, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { fmtDate, num, vnd } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';

const keyOf = (l) => (l.treatment_line_id ? `t${l.treatment_line_id}` : `p${l.prescription_item_id}`);

// Cùng cách phân bổ với server: theo tỷ lệ phần còn phải trả của từng dòng, phần lẻ vào dòng cuối
function allocate(lines, lineDiscounts, totalDiscount) {
  const rows = lines.map((l) => ({ ...l, discount: Number(lineDiscounts[keyOf(l)] || 0) }));
  const afterLine = rows.reduce((s, l) => s + l.gross - l.discount, 0);
  const payable = rows.filter((l) => l.gross - l.discount > 0);
  let left = Math.min(totalDiscount, afterLine);
  payable.forEach((l, i) => {
    const share = i === payable.length - 1 ? left : Math.min(left, Math.round((totalDiscount * (l.gross - l.discount)) / afterLine));
    l.allocated = share;
    left -= share;
  });
  return rows.map((l) => ({ ...l, allocated: l.allocated ?? 0, amount: l.gross - l.discount - (l.allocated ?? 0) }));
}

export default function NewInvoicePage() {
  const { recordId } = useParams();
  const router = useRouter();
  const preview = useApi(`/billing/preview/${recordId}`);
  const [lineDiscounts, setLineDiscounts] = useState({});
  const [totalDiscount, setTotalDiscount] = useState('');
  const [reason, setReason] = useState('');
  const action = useAction();

  if (!preview.data) return <Loading state={preview} />;
  const d = preview.data;
  if (d.invoice_id) {
    return <Alert warn={<>Phiếu này đã có hóa đơn — <Link href={`/invoices/${d.invoice_id}`}>mở hóa đơn #{d.invoice_id}</Link></>} />;
  }
  const rows = allocate(d.lines, lineDiscounts, Number(totalDiscount || 0));
  const gross = rows.reduce((s, l) => s + l.gross, 0);
  const total = rows.reduce((s, l) => s + l.amount, 0);
  const hasDiscount = gross !== total;

  async function submit() {
    const res = await action.run(() => api('/invoices', {
      method: 'POST',
      body: { record_id: Number(recordId), line_discounts: lineDiscounts, total_discount: Number(totalDiscount || 0), discount_reason: reason },
    }));
    if (res) router.push(`/invoices/${res.id}`);
  }

  return (
    <>
      <PageHeader title="Lập hóa đơn lượt khám" subtitle={`${d.patient_name} · ${d.contact_phone} · khám ${fmtDate(d.appt_date)} ${d.slot_time} · ${d.doctor_name}`}>
        <Link className="btn" href={`/records/${recordId}`}>Xem phiếu</Link>
      </PageHeader>
      <Alert error={action.error} />
      <div className="card card-tight">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Mô tả</th><th className="num">SL</th><th className="num">Đơn giá (ngày khám)</th><th className="num">Thành tiền</th><th className="num">Giảm theo dòng</th><th className="num">Giảm ở tổng (phân bổ)</th><th className="num">Phải trả</th></tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={keyOf(l)}>
                  <td>{l.description}</td><td className="num">{num(l.quantity)}</td><td className="num">{vnd(l.unit_price)}</td>
                  <td className="num">{vnd(l.gross)}</td>
                  <td className="num" style={{ width: 150 }}>
                    <input type="number" min="0" max={l.gross} value={lineDiscounts[keyOf(l)] ?? ''} placeholder="0"
                      onChange={(e) => setLineDiscounts({ ...lineDiscounts, [keyOf(l)]: e.target.value })} />
                  </td>
                  <td className="num muted">{l.allocated ? `−${num(l.allocated)}` : '—'}</td>
                  <td className="num"><strong>{vnd(l.amount)}</strong></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={3}>Tổng</td><td className="num">{vnd(gross)}</td><td colSpan={2} /><td className="num">{vnd(total)}</td></tr></tfoot>
          </table>
        </div>
      </div>
      <div className="card">
        <div className="form-grid">
          <Field label="Giảm ở tổng (₫)" hint="tự chia xuống từng dòng theo tỷ lệ">
            <input type="number" min="0" value={totalDiscount} onChange={(e) => setTotalDiscount(e.target.value)} placeholder="0" />
          </Field>
          <Field label={`Lý do giảm giá${hasDiscount ? ' *' : ''}`}><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Khách quen, khuyến mãi…" /></Field>
          <button type="button" className="btn btn-primary" disabled={action.busy || (hasDiscount && !reason.trim())} onClick={submit}>
            Lập hóa đơn {vnd(total)}
          </button>
        </div>
        <p className="small muted mt">Giá được chép cố định vào hóa đơn; bảng giá đổi sau này không ảnh hưởng (LN-05). Thuốc chỉ tính khi cấp tại phòng khám.</p>
      </div>
    </>
  );
}
