'use client';

// UC62 Quản lý danh mục: dịch vụ, ghế, lý do hủy, thuốc & vật tư (ngưỡng), định mức vật tư theo dịch vụ
import { useState } from 'react';
import { Alert, EmptyRow, Field, Loading, Modal, PageHeader, Tabs } from '@/components/ui';
import { api } from '@/lib/api';
import { ITEM_KIND, SERVICE_KIND, num, vnd } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';

function ActiveBadge({ active }) {
  return active ? <span className="badge badge-ok">Đang dùng</span> : <span className="badge">Ngừng</span>;
}

export default function CatalogPage() {
  const cat = useApi('/catalog');
  const action = useAction();
  const [tab, setTab] = useState('services');
  const [edit, setEdit] = useState(null);
  const [svc, setSvc] = useState({ code: '', name: '', kind: 'single' });
  const [simpleName, setSimpleName] = useState('');
  const [item, setItem] = useState({ kind: 'supply', name: '', unit: '', reorder_threshold: '', sale_price: '' });
  const [supply, setSupply] = useState({ service_id: '', item_id: '', quantity: '' });

  async function call(fn, message, after) {
    const ok = await action.run(fn, message);
    if (ok !== undefined) { after?.(); setEdit(null); cat.reload(); }
  }
  if (!cat.data) return <Loading state={cat} />;
  const { services, chairs, cancelReasons, items, supplies } = cat.data;
  const toggle = (path, row) => call(() => api(path, { method: 'PATCH', body: { ...row, is_active: !row.is_active } }), row.is_active ? 'Đã ngừng dùng' : 'Đã dùng lại');

  return (
    <>
      <PageHeader title="Danh mục" subtitle="Không xóa mục đã dùng — chỉ ngừng dùng để giữ lịch sử" />
      <Alert error={action.error} ok={action.ok} />
      <Tabs value={tab} onChange={setTab} tabs={[['services', 'Dịch vụ'], ['chairs', 'Ghế'], ['reasons', 'Lý do hủy'], ['items', 'Thuốc & vật tư'], ['supplies', 'Định mức vật tư']]} />

      {tab === 'services' && (
        <>
          <form className="card" onSubmit={(e) => { e.preventDefault(); call(() => api('/catalog/services', { method: 'POST', body: svc }), 'Đã thêm dịch vụ', () => setSvc({ code: '', name: '', kind: 'single' })); }}>
            <div className="form-grid">
              <Field label="Mã"><input value={svc.code} onChange={(e) => setSvc({ ...svc, code: e.target.value })} required placeholder="TRAM" /></Field>
              <Field label="Tên"><input value={svc.name} onChange={(e) => setSvc({ ...svc, name: e.target.value })} required /></Field>
              <Field label="Loại">
                <select value={svc.kind} onChange={(e) => setSvc({ ...svc, kind: e.target.value })}><option value="single">Dịch vụ lẻ</option><option value="plan">Liệu trình (niềng, implant…)</option></select>
              </Field>
              <button className="btn btn-primary" disabled={action.busy}>+ Thêm dịch vụ</button>
            </div>
            <p className="small muted">Giá dịch vụ lẻ đặt ở màn Bảng giá.</p>
          </form>
          <div className="card card-tight"><table className="table">
            <thead><tr><th>Mã</th><th>Tên</th><th>Loại</th><th>Trạng thái</th><th /></tr></thead>
            <tbody>{services.map((s) => (
              <tr key={s.id}><td className="muted">{s.code}</td><td>{s.name}</td><td>{SERVICE_KIND[s.kind]}</td><td><ActiveBadge active={s.is_active} /></td>
                <td className="right nowrap"><button type="button" className="btn btn-sm" onClick={() => setEdit({ path: `/catalog/services/${s.id}`, row: s })}>Đổi tên</button>{' '}
                  <button type="button" className="btn btn-sm" onClick={() => toggle(`/catalog/services/${s.id}`, s)}>{s.is_active ? 'Ngừng' : 'Dùng lại'}</button></td></tr>
            ))}</tbody>
          </table></div>
        </>
      )}

      {(tab === 'chairs' || tab === 'reasons') && (() => {
        const rows = tab === 'chairs' ? chairs : cancelReasons;
        const base = tab === 'chairs' ? '/catalog/chairs' : '/catalog/cancel-reasons';
        return (
          <>
            <form className="card row" onSubmit={(e) => { e.preventDefault(); call(() => api(base, { method: 'POST', body: { name: simpleName } }), 'Đã thêm', () => setSimpleName('')); }}>
              <input value={simpleName} onChange={(e) => setSimpleName(e.target.value)} placeholder={tab === 'chairs' ? 'Ghế 4' : 'Lý do hủy mới'} required style={{ maxWidth: 320 }} />
              <button className="btn btn-primary" disabled={action.busy}>+ Thêm</button>
            </form>
            <div className="card card-tight"><table className="table">
              <thead><tr><th>Tên</th><th>Trạng thái</th><th /></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id}><td>{r.name}</td><td><ActiveBadge active={r.is_active} /></td>
                  <td className="right nowrap"><button type="button" className="btn btn-sm" onClick={() => setEdit({ path: `${base}/${r.id}`, row: r })}>Đổi tên</button>{' '}
                    <button type="button" className="btn btn-sm" onClick={() => toggle(`${base}/${r.id}`, r)}>{r.is_active ? 'Ngừng' : 'Dùng lại'}</button></td></tr>
              ))}</tbody>
            </table></div>
          </>
        );
      })()}

      {tab === 'items' && (
        <>
          <form className="card" onSubmit={(e) => { e.preventDefault(); call(() => api('/catalog/items', { method: 'POST', body: item }), 'Đã thêm', () => setItem({ ...item, name: '', unit: '', reorder_threshold: '', sale_price: '' })); }}>
            <div className="form-grid">
              <Field label="Loại"><select value={item.kind} onChange={(e) => setItem({ ...item, kind: e.target.value })}><option value="supply">Vật tư</option><option value="medicine">Thuốc</option></select></Field>
              <Field label="Tên"><input value={item.name} onChange={(e) => setItem({ ...item, name: e.target.value })} required /></Field>
              <Field label="Đơn vị"><input value={item.unit} onChange={(e) => setItem({ ...item, unit: e.target.value })} required placeholder="viên, hộp, ống…" /></Field>
              <Field label="Ngưỡng đặt thêm"><input type="number" min="0" step="any" value={item.reorder_threshold} onChange={(e) => setItem({ ...item, reorder_threshold: e.target.value })} required /></Field>
              {item.kind === 'medicine' && <Field label="Giá bán (₫)"><input type="number" min="0" value={item.sale_price} onChange={(e) => setItem({ ...item, sale_price: e.target.value })} /></Field>}
              <button className="btn btn-primary" disabled={action.busy}>+ Thêm</button>
            </div>
          </form>
          <div className="card card-tight"><table className="table">
            <thead><tr><th>Loại</th><th>Tên</th><th>Đơn vị</th><th className="num">Ngưỡng</th><th className="num">Giá bán</th><th>Trạng thái</th><th /></tr></thead>
            <tbody>{items.map((i) => (
              <tr key={i.id}><td>{ITEM_KIND[i.kind]}</td><td>{i.name}</td><td>{i.unit}</td><td className="num">{num(i.reorder_threshold)}</td><td className="num">{i.kind === 'medicine' ? vnd(i.sale_price) : '—'}</td><td><ActiveBadge active={i.is_active} /></td>
                <td className="right nowrap"><button type="button" className="btn btn-sm" onClick={() => setEdit({ path: `/catalog/items/${i.id}`, row: i, item: true })}>Sửa</button>{' '}
                  <button type="button" className="btn btn-sm" onClick={() => toggle(`/catalog/items/${i.id}`, i)}>{i.is_active ? 'Ngừng' : 'Dùng lại'}</button></td></tr>
            ))}</tbody>
          </table></div>
        </>
      )}

      {tab === 'supplies' && (
        <>
          <form className="card" onSubmit={(e) => { e.preventDefault(); call(() => api('/catalog/supplies', { method: 'PUT', body: supply }), 'Đã lưu định mức', () => setSupply({ ...supply, quantity: '' })); }}>
            <div className="form-grid">
              <Field label="Dịch vụ"><select value={supply.service_id} onChange={(e) => setSupply({ ...supply, service_id: e.target.value })} required><option value="">— Chọn —</option>{services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
              <Field label="Vật tư"><select value={supply.item_id} onChange={(e) => setSupply({ ...supply, item_id: e.target.value })} required><option value="">— Chọn —</option>{items.filter((i) => i.kind === 'supply').map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}</select></Field>
              <Field label="Số lượng / lần làm"><input type="number" min="0.01" step="any" value={supply.quantity} onChange={(e) => setSupply({ ...supply, quantity: e.target.value })} required /></Field>
              <button className="btn btn-primary" disabled={action.busy}>Lưu định mức</button>
            </div>
            <p className="small muted">Khi bác sĩ lưu một dòng việc, kho tự trừ theo định mức này; sửa / xóa dòng thì hoàn lại.</p>
          </form>
          <div className="card card-tight"><table className="table">
            <thead><tr><th>Dịch vụ</th><th>Vật tư</th><th className="num">Định mức</th><th /></tr></thead>
            <tbody>
              {supplies.length === 0 && <EmptyRow cols={4} />}
              {supplies.map((s) => (
                <tr key={`${s.service_id}-${s.item_id}`}><td>{s.service_name}</td><td>{s.item_name}</td><td className="num">{num(s.quantity)} {s.unit}</td>
                  <td className="right"><button type="button" className="btn btn-sm btn-danger" onClick={() => call(() => api(`/catalog/supplies?service_id=${s.service_id}&item_id=${s.item_id}`, { method: 'DELETE' }), 'Đã bỏ định mức')}>Bỏ</button></td></tr>
              ))}
            </tbody>
          </table></div>
        </>
      )}

      {edit && (
        <Modal title="Sửa danh mục" onClose={() => setEdit(null)} footer={<>
          <button type="button" className="btn" onClick={() => setEdit(null)}>Đóng</button>
          <button type="button" className="btn btn-primary" disabled={action.busy} onClick={() => call(() => api(edit.path, { method: 'PATCH', body: edit.row }), 'Đã lưu')}>Lưu</button>
        </>}>
          <Alert error={action.error} />
          <div className="form-grid">
            <Field label="Tên"><input value={edit.row.name} onChange={(e) => setEdit({ ...edit, row: { ...edit.row, name: e.target.value } })} /></Field>
            {edit.item && <>
              <Field label="Đơn vị"><input value={edit.row.unit} onChange={(e) => setEdit({ ...edit, row: { ...edit.row, unit: e.target.value } })} /></Field>
              <Field label="Ngưỡng đặt thêm"><input type="number" min="0" step="any" value={edit.row.reorder_threshold} onChange={(e) => setEdit({ ...edit, row: { ...edit.row, reorder_threshold: e.target.value } })} /></Field>
              {edit.row.kind === 'medicine' && <Field label="Giá bán (₫)"><input type="number" min="0" value={edit.row.sale_price ?? ''} onChange={(e) => setEdit({ ...edit, row: { ...edit.row, sale_price: e.target.value } })} /></Field>}
            </>}
          </div>
        </Modal>
      )}
    </>
  );
}
