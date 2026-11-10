'use client';

// UC50 Nhập kho · UC51 Xuất thủ công / điều chỉnh kiểm kê · tồn kho và cảnh báo dưới ngưỡng (LN-14)
import Link from 'next/link';
import { useState } from 'react';
import { Alert, EmptyRow, Field, Loading, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { ITEM_KIND, MOVEMENT_TYPE, fmtDateTime, num } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';

export default function InventoryPage() {
  const inv = useApi('/inventory');
  const [form, setForm] = useState({ item_id: '', movement_type: 'receipt', quantity: '', note: '' });
  const action = useAction();

  async function submit(e) {
    e.preventDefault();
    const ok = await action.run(() => api('/inventory/movements', { method: 'POST', body: form }), 'Đã ghi phiếu kho');
    if (ok) { setForm({ ...form, quantity: '', note: '' }); inv.reload(); }
  }

  return (
    <>
      <PageHeader title="Kho thuốc & vật tư" subtitle="Vật tư tự trừ theo định mức khi lưu phiếu điều trị; thuốc tự trừ khi cấp tại phòng khám">
        <Link className="btn" href="/admin/catalog">Định mức & ngưỡng</Link>
      </PageHeader>
      <Alert error={action.error} ok={action.ok} />
      <Loading state={inv} />
      {inv.data && (
        <>
          <form className="card" onSubmit={submit}>
            <h2>Ghi phiếu kho</h2>
            <div className="form-grid">
              <Field label="Thuốc / vật tư">
                <select value={form.item_id} onChange={(e) => setForm({ ...form, item_id: e.target.value })} required>
                  <option value="">— Chọn —</option>
                  {inv.data.stock.map((s) => <option key={s.item_id} value={s.item_id}>{s.name} (tồn {num(s.on_hand)} {s.unit})</option>)}
                </select>
              </Field>
              <Field label="Loại phiếu">
                <select value={form.movement_type} onChange={(e) => setForm({ ...form, movement_type: e.target.value })}>
                  <option value="receipt">Nhập kho</option><option value="manual_out">Xuất thủ công (hỏng, dùng ngoài phiếu)</option><option value="adjustment">Điều chỉnh kiểm kê (± số lượng)</option>
                </select>
              </Field>
              <Field label="Số lượng" hint={form.movement_type === 'adjustment' ? 'âm nếu thiếu' : undefined}>
                <input type="number" step="any" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} required />
              </Field>
              <Field label={`Ghi chú${form.movement_type === 'receipt' ? '' : ' *'}`}><input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} required={form.movement_type !== 'receipt'} /></Field>
              <button className="btn btn-primary" disabled={action.busy}>Ghi phiếu</button>
            </div>
          </form>

          <div className="card card-tight">
            <h2>Tồn kho</h2>
            <table className="table">
              <thead><tr><th>Loại</th><th>Tên</th><th className="num">Tồn</th><th className="num">Ngưỡng đặt thêm</th><th>Tình trạng</th></tr></thead>
              <tbody>
                {inv.data.stock.map((s) => (
                  <tr key={s.item_id} className={s.below_threshold ? 'highlight' : ''}>
                    <td>{ITEM_KIND[s.kind]}</td><td>{s.name}</td><td className="num">{num(s.on_hand)} {s.unit}</td><td className="num">{num(s.reorder_threshold)}</td>
                    <td>{s.below_threshold ? <span className="badge badge-warn">Sắp hết — cần đặt thêm</span> : <span className="badge badge-ok">Đủ</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card card-tight">
            <h2>Lịch sử nhập / xuất (100 gần nhất)</h2>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Lúc</th><th>Tên</th><th>Loại</th><th className="num">Số lượng</th><th>Ghi chú</th><th>Người ghi</th></tr></thead>
                <tbody>
                  {inv.data.movements.length === 0 && <EmptyRow cols={6} />}
                  {inv.data.movements.map((m) => (
                    <tr key={m.id}>
                      <td className="small nowrap">{fmtDateTime(m.created_at)}</td><td>{m.item_name}</td><td>{MOVEMENT_TYPE[m.movement_type]}</td>
                      <td className="num" style={{ color: m.quantity > 0 ? 'var(--ok)' : 'var(--danger)' }}>{m.quantity > 0 ? '+' : ''}{num(m.quantity)} {m.unit}</td>
                      <td className="small">{m.note}{m.record_id && <> · <Link href={`/records/${m.record_id}`}>phiếu #{m.record_id}</Link></>}</td>
                      <td className="small">{m.created_by_name}</td>
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
