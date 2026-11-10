'use client';

// UC31 Lập phiếu điều trị · UC32 Kê đơn · UC33 Ghi buổi liệu trình · UC34 Tạo liệu trình
// UC35 Sửa phiếu · UC36 Xem lịch sử sửa
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Alert, EmptyRow, Field, Loading, Modal, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { ACTION_LABEL, TABLE_LABEL, addDays, age, fmtDate, fmtDateTime, num, toothLabel, todayLocal, vnd } from '@/lib/format';
import { useAction, useApi, useUser } from '@/lib/hooks';

const TOOTH_HINT = 'FDI: 11–48 răng vĩnh viễn, 51–85 răng sữa; 00 cả miệng, 01 hàm trên, 02 hàm dưới';
const HIDDEN_AUDIT_KEYS = new Set(['id', 'record_id', 'created_at', 'created_by']);

function AuditChanges({ a }) {
  const before = a.old_data ?? {};
  const after = a.new_data ?? {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((k) => !HIDDEN_AUDIT_KEYS.has(k) && JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  if (a.action !== 'UPDATE') {
    const row = a.new_data ?? a.old_data;
    return <span className="small">{row.tooth_code ? `răng ${row.tooth_code}` : row.dosage ?? ''}</span>;
  }
  return <span className="small">{keys.map((k) => `${k}: ${before[k] ?? '∅'} → ${after[k] ?? '∅'}`).join('; ')}</span>;
}

function LineModal({ line, lookups, onClose, onSave, busy, error }) {
  const [form, setForm] = useState({
    service_id: String(line.service_id), tooth_code: line.tooth_code, doctor_id: String(line.doctor_id), note: line.note ?? '', reason: '',
  });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <Modal title="Sửa dòng việc" onClose={onClose} footer={<>
      <button type="button" className="btn" onClick={onClose}>Đóng</button>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onSave(form)}>Lưu</button>
    </>}>
      <Alert error={error} />
      <div className="form-grid">
        <Field label="Dịch vụ">
          <select value={form.service_id} onChange={set('service_id')}>
            {lookups.services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Số răng" hint="FDI"><input value={form.tooth_code} onChange={set('tooth_code')} maxLength={2} /></Field>
        <Field label="Bác sĩ thực hiện">
          <select value={form.doctor_id} onChange={set('doctor_id')}>
            {lookups.doctors.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
          </select>
        </Field>
        <Field label="Ghi chú"><input value={form.note} onChange={set('note')} /></Field>
      </div>
      <div className="mt"><Field label="Lý do sửa" hint="ghi vào lịch sử sửa phiếu"><input value={form.reason} onChange={set('reason')} /></Field></div>
    </Modal>
  );
}

function PlanModal({ record, lookups, onClose, onCreated }) {
  const plans = lookups.services.filter((s) => s.kind === 'plan');
  const [form, setForm] = useState({ service_id: String(plans[0]?.id ?? ''), total_price: '', planned_sessions: '', note: '' });
  const [installments, setInstallments] = useState([{ amount: '', due_date: todayLocal() }]);
  const action = useAction();
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const sum = installments.reduce((s, x) => s + Number(x.amount || 0), 0);
  const total = Number(form.total_price || 0);

  async function submit() {
    const res = await action.run(() => api('/plans', { method: 'POST', body: { ...form, patient_id: record.patient_id, installments } }));
    if (res) onCreated(res.id);
  }
  return (
    <Modal title="Tạo liệu trình mới" wide onClose={onClose} footer={<>
      <button type="button" className="btn" onClick={onClose}>Đóng</button>
      <button type="button" className="btn btn-primary" disabled={action.busy || sum !== total || !total} onClick={submit}>Tạo liệu trình</button>
    </>}>
      <p className="muted small">Giá chốt lúc tạo; tiền trả theo đợt — tổng các đợt phải bằng tổng giá. Bạn là bác sĩ phụ trách.</p>
      <Alert error={action.error} />
      <div className="form-grid">
        <Field label="Loại liệu trình">
          <select value={form.service_id} onChange={set('service_id')}>
            {plans.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Tổng giá (₫)"><input type="number" min="1" value={form.total_price} onChange={set('total_price')} /></Field>
        <Field label="Số buổi dự kiến"><input type="number" min="1" value={form.planned_sessions} onChange={set('planned_sessions')} /></Field>
        <Field label="Ghi chú"><input value={form.note} onChange={set('note')} /></Field>
      </div>
      <h3 className="mt">Kế hoạch đợt trả</h3>
      <div className="stack">
        {installments.map((x, i) => (
          <div key={i} className="row">
            <span className="muted" style={{ width: 50 }}>Đợt {i + 1}</span>
            <input type="number" min="1" placeholder="Số tiền" value={x.amount} style={{ maxWidth: 180 }}
              onChange={(e) => setInstallments(installments.map((y, j) => (j === i ? { ...y, amount: e.target.value } : y)))} />
            <input type="date" value={x.due_date} style={{ maxWidth: 170 }}
              onChange={(e) => setInstallments(installments.map((y, j) => (j === i ? { ...y, due_date: e.target.value } : y)))} />
            {installments.length > 1 && <button type="button" className="btn btn-sm" onClick={() => setInstallments(installments.filter((_, j) => j !== i))}>Bỏ</button>}
          </div>
        ))}
        <div className="row">
          <button type="button" className="btn btn-sm" onClick={() => setInstallments([...installments, {
            amount: Math.max(total - sum, 0) || '', due_date: addDays(installments.at(-1).due_date, 90),
          }])}>+ Thêm đợt</button>
          <span className={sum === total ? 'small' : 'small muted'}>Tổng các đợt: {vnd(sum)} / {vnd(total)}</span>
        </div>
      </div>
    </Modal>
  );
}

export default function RecordPage() {
  const { id } = useParams();
  const user = useUser();
  const detail = useApi(`/records/${id}`);
  const lookups = useApi('/lookups');
  const action = useAction();
  const [lineForm, setLineForm] = useState({ service_id: '', tooth_code: '', doctor_id: '', plan_id: '', note: '' });
  const [rxForm, setRxForm] = useState({ item_id: '', dosage: '', quantity: '', dispensed_in_clinic: true });
  const [notes, setNotes] = useState(null);
  const [editLine, setEditLine] = useState(null);
  const [planModal, setPlanModal] = useState(false);

  if (!detail.data || !lookups.data) return <Loading state={detail.error ? detail : lookups} />;
  const { record: r, lines, prescriptions, plans, invoice, audit, canEdit } = detail.data;
  const L = lookups.data;
  const noteForm = notes ?? { diagnosis: r.diagnosis ?? '', note: r.note ?? '', reason: '' };

  async function call(fn, message) {
    const ok = await action.run(fn, message);
    if (ok !== undefined) detail.reload();
    return ok;
  }
  const addLine = async (e) => {
    e.preventDefault();
    const ok = await call(() => api(`/records/${id}/lines`, { method: 'POST', body: lineForm }), 'Đã thêm việc');
    if (ok) setLineForm({ ...lineForm, tooth_code: '', note: '' });
  };
  const addRx = async (e) => {
    e.preventDefault();
    const ok = await call(() => api(`/records/${id}/prescriptions`, { method: 'POST', body: rxForm }), 'Đã thêm thuốc');
    if (ok) setRxForm({ ...rxForm, item_id: '', dosage: '', quantity: '' });
  };
  const selectedService = L.services.find((s) => String(s.id) === lineForm.service_id);

  return (
    <>
      <PageHeader title={`Phiếu điều trị #${r.id}`}
        subtitle={`${fmtDate(r.appt_date)} ${r.slot_time} · ${r.chair_name} · BS chính: ${r.primary_doctor_name} · Lập bởi ${r.created_by_name}`}>
        {user.role === 'dentist' && <Link className="btn" href={`/appointments/new?patient_id=${r.patient_id}&doctor_id=${user.id}`}>Hẹn buổi sau</Link>}
        {invoice && <Link className="btn" href={`/invoices/${invoice.invoice_id}`}>Hóa đơn #{invoice.invoice_id}</Link>}
      </PageHeader>
      <Alert error={action.error} ok={action.ok} />
      {!canEdit && <Alert warn={user.role === 'dentist' ? 'Chỉ bác sĩ lập phiếu mới sửa được phiếu này.' : 'Chế độ xem — chỉ bác sĩ lập phiếu được sửa.'} />}

      <div className="grid grid-2">
        <div className="card">
          <h2><Link href={`/patients/${r.patient_id}`}>{r.patient_name}</Link></h2>
          <dl className="kv">
            <dt>Tuổi</dt><dd>{r.date_of_birth ? `${age(r.date_of_birth)} (${fmtDate(r.date_of_birth)})` : '—'}</dd>
            <dt>SĐT</dt><dd>{r.contact_phone}</dd>
            <dt>Hóa đơn</dt><dd>{invoice ? `${vnd(invoice.total)} — đã thu ${vnd(invoice.paid)}` : 'Chưa lập (lễ tân lập khi khách ra quầy)'}</dd>
          </dl>
          {r.medical_note && <div className="alert alert-warn mt">⚠ Tiền sử / dị ứng: {r.medical_note}</div>}
        </div>
        <form className="card" onSubmit={(e) => { e.preventDefault(); call(() => api(`/records/${id}`, { method: 'PUT', body: noteForm }), 'Đã lưu chẩn đoán'); setNotes(null); }}>
          <Field label="Chẩn đoán"><input value={noteForm.diagnosis} disabled={!canEdit} onChange={(e) => setNotes({ ...noteForm, diagnosis: e.target.value })} /></Field>
          <div className="mt"><Field label="Ghi chú"><textarea value={noteForm.note} disabled={!canEdit} onChange={(e) => setNotes({ ...noteForm, note: e.target.value })} /></Field></div>
          {canEdit && (
            <div className="row mt">
              <input placeholder="Lý do sửa (nếu sửa lại)" value={noteForm.reason} onChange={(e) => setNotes({ ...noteForm, reason: e.target.value })} style={{ flex: 1 }} />
              <button className="btn" disabled={action.busy || notes === null}>Lưu</button>
            </div>
          )}
        </form>
      </div>

      <div className="card card-tight">
        <h2>Việc đã làm</h2>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>#</th><th>Dịch vụ</th><th>Răng</th><th>Bác sĩ thực hiện</th><th>Liệu trình</th><th className="num">Đơn giá</th><th>Ghi chú</th>{canEdit && <th />}</tr></thead>
            <tbody>
              {lines.length === 0 && <EmptyRow cols={8}>Chưa ghi việc nào</EmptyRow>}
              {lines.map((l, i) => (
                <tr key={l.id}>
                  <td className="muted">{i + 1}</td><td>{l.service_name}</td>
                  <td className="nowrap"><strong>{l.tooth_code}</strong> <span className="small muted">{toothLabel(l.tooth_code)}</span></td>
                  <td>{l.doctor_name}{l.doctor_id !== r.primary_doctor_id && <span className="badge" style={{ marginLeft: 6 }}>BS phụ</span>}</td>
                  <td>{l.plan_id ? <Link href={`/plans/${l.plan_id}`}>{l.plan_name} · buổi {l.session_no}</Link> : '—'}</td>
                  <td className="num">{l.plan_id ? <span className="muted small">trong giá liệu trình</span> : vnd(l.unit_price)}</td>
                  <td>{l.note ?? ''}</td>
                  {canEdit && (
                    <td className="right nowrap">
                      <button type="button" className="btn btn-sm" onClick={() => setEditLine(l)}>Sửa</button>{' '}
                      <button type="button" className="btn btn-sm btn-danger" onClick={() => {
                        const reason = window.prompt('Lý do xóa dòng việc:');
                        if (reason !== null) call(() => api(`/lines/${l.id}`, { method: 'DELETE', body: { reason } }), 'Đã xóa dòng');
                      }}>Xóa</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canEdit && (
          <form onSubmit={addLine} style={{ padding: 16, borderTop: '1px solid var(--border)' }}>
            <div className="form-grid">
              <Field label="Dịch vụ *">
                <select value={lineForm.service_id} onChange={(e) => {
                  const s = L.services.find((x) => String(x.id) === e.target.value);
                  setLineForm({ ...lineForm, service_id: e.target.value, plan_id: s?.kind === 'plan' ? String(plans[0]?.plan_id ?? '') : lineForm.plan_id });
                }} required>
                  <option value="">— Chọn —</option>
                  {L.services.map((s) => <option key={s.id} value={s.id}>{s.name}{s.kind === 'plan' ? ' (liệu trình)' : ''}</option>)}
                </select>
              </Field>
              <Field label="Số răng *" hint="FDI">
                <input value={lineForm.tooth_code} onChange={(e) => setLineForm({ ...lineForm, tooth_code: e.target.value })}
                  maxLength={2} placeholder="16, 75, 00…" title={TOOTH_HINT} required />
              </Field>
              <Field label="Bác sĩ thực hiện">
                <select value={lineForm.doctor_id} onChange={(e) => setLineForm({ ...lineForm, doctor_id: e.target.value })}>
                  <option value="">{r.primary_doctor_name} (BS chính)</option>
                  {L.doctors.filter((d) => d.id !== r.primary_doctor_id).map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
                </select>
              </Field>
              <Field label="Thuộc liệu trình">
                <select value={lineForm.plan_id} onChange={(e) => setLineForm({ ...lineForm, plan_id: e.target.value })}>
                  <option value="">Không (tính tiền lẻ)</option>
                  {plans.map((p) => <option key={p.plan_id} value={p.plan_id}>{p.service_name} — đã {p.sessions_done}/{p.planned_sessions} buổi</option>)}
                </select>
              </Field>
              <Field label="Ghi chú"><input value={lineForm.note} onChange={(e) => setLineForm({ ...lineForm, note: e.target.value })} /></Field>
              <div className="row">
                <button className="btn btn-primary" disabled={action.busy}>+ Thêm việc</button>
                <button type="button" className="btn" onClick={() => setPlanModal(true)}>Tạo liệu trình…</button>
              </div>
            </div>
            <p className="small muted" style={{ margin: '8px 0 0' }}>
              {TOOTH_HINT}.{selectedService?.kind === 'plan' && !plans.length && ' Bệnh nhân chưa có liệu trình đang mở — bấm "Tạo liệu trình".'}
            </p>
          </form>
        )}
      </div>

      <div className="card card-tight">
        <h2>Đơn thuốc</h2>
        <table className="table">
          <thead><tr><th>Thuốc</th><th>Liều dùng</th><th className="num">Số lượng</th><th>Nơi lấy</th>{canEdit && <th />}</tr></thead>
          <tbody>
            {prescriptions.length === 0 && <EmptyRow cols={5}>Không kê thuốc</EmptyRow>}
            {prescriptions.map((p) => (
              <tr key={p.id}>
                <td>{p.item_name}</td><td>{p.dosage}</td><td className="num">{num(p.quantity)} {p.unit}</td>
                <td>{p.dispensed_in_clinic ? <span className="badge badge-ok">Cấp tại phòng khám</span> : <span className="badge">Mua ngoài</span>}</td>
                {canEdit && <td className="right"><button type="button" className="btn btn-sm btn-danger" onClick={() => call(() => api(`/prescriptions/${p.id}`, { method: 'DELETE', body: {} }), 'Đã bỏ thuốc')}>Bỏ</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
        {canEdit && (
          <form onSubmit={addRx} style={{ padding: 16, borderTop: '1px solid var(--border)' }}>
            <div className="form-grid">
              <Field label="Thuốc *">
                <select value={rxForm.item_id} onChange={(e) => setRxForm({ ...rxForm, item_id: e.target.value })} required>
                  <option value="">— Chọn —</option>
                  {L.medicines.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}
                </select>
              </Field>
              <Field label="Liều dùng *"><input value={rxForm.dosage} onChange={(e) => setRxForm({ ...rxForm, dosage: e.target.value })} placeholder="2 viên/ngày sau ăn" required /></Field>
              <Field label="Số lượng *"><input type="number" min="0.5" step="0.5" value={rxForm.quantity} onChange={(e) => setRxForm({ ...rxForm, quantity: e.target.value })} required /></Field>
              <label className="check"><input type="checkbox" checked={rxForm.dispensed_in_clinic} onChange={(e) => setRxForm({ ...rxForm, dispensed_in_clinic: e.target.checked })} /> Cấp tại phòng khám (trừ kho, tính tiền)</label>
              <button className="btn btn-primary" disabled={action.busy}>+ Kê thuốc</button>
            </div>
          </form>
        )}
      </div>

      <div className="card card-tight">
        <h2>Lịch sử sửa phiếu</h2>
        <table className="table">
          <thead><tr><th>Lúc</th><th>Người</th><th>Thao tác</th><th>Thay đổi</th><th>Lý do</th></tr></thead>
          <tbody>
            {audit.length === 0 && <EmptyRow cols={5}>Chưa có thay đổi</EmptyRow>}
            {audit.map((a) => (
              <tr key={a.id}>
                <td className="nowrap small">{fmtDateTime(a.changed_at)}</td><td>{a.changed_by_name}</td>
                <td>{ACTION_LABEL[a.action]} {TABLE_LABEL[a.table_name]?.toLowerCase()}</td>
                <td><AuditChanges a={a} /></td><td>{a.reason ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editLine && (
        <LineModal line={editLine} lookups={L} busy={action.busy} error={action.error} onClose={() => setEditLine(null)}
          onSave={async (form) => {
            const ok = await call(() => api(`/lines/${editLine.id}`, { method: 'PUT', body: form }), 'Đã sửa dòng việc');
            if (ok) setEditLine(null);
          }} />
      )}
      {planModal && (
        <PlanModal record={r} lookups={L} onClose={() => setPlanModal(false)}
          onCreated={(planId) => { setPlanModal(false); setLineForm({ ...lineForm, plan_id: String(planId) }); detail.reload(); }} />
      )}
    </>
  );
}
