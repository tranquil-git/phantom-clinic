'use client';

// UC11 / UC12: hồ sơ bệnh nhân; dưới 15 tuổi phải có người giám hộ (mục 3.2)
import { useState } from 'react';
import { age } from '@/lib/format';
import { Alert, Field } from './ui';

const EMPTY = {
  full_name: '', date_of_birth: '', gender: '', contact_phone: '', guardian_name: '', guardian_relation: '',
  paper_record_no: '', address: '', medical_note: '', is_active: true,
};

export default function PatientForm({ initial, onSubmit, busy, error, submitLabel = 'Lưu hồ sơ' }) {
  const [form, setForm] = useState(() => ({ ...EMPTY, ...Object.fromEntries(
    Object.entries(initial ?? {}).map(([k, v]) => [k, v ?? '']),
  ) }));
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const years = form.date_of_birth ? age(form.date_of_birth) : null;
  const child = years !== null && years < 15;

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(form); }}>
      <Alert error={error} />
      <div className="form-grid">
        <Field label="Họ tên *"><input value={form.full_name} onChange={set('full_name')} required /></Field>
        <Field label="Ngày sinh" hint={years !== null ? `${years} tuổi` : undefined}>
          <input type="date" value={form.date_of_birth} onChange={set('date_of_birth')} />
        </Field>
        <Field label="Giới tính">
          <select value={form.gender} onChange={set('gender')}>
            <option value="">—</option><option value="female">Nữ</option><option value="male">Nam</option><option value="other">Khác</option>
          </select>
        </Field>
        <Field label="SĐT liên hệ *" hint={child ? 'số của người giám hộ' : 'không cần duy nhất'}>
          <input inputMode="tel" value={form.contact_phone} onChange={set('contact_phone')} required pattern="0[0-9]{9,10}" />
        </Field>
        <Field label={`Người giám hộ${child ? ' *' : ''}`}>
          <input value={form.guardian_name} onChange={set('guardian_name')} required={child} />
        </Field>
        <Field label={`Quan hệ${child ? ' *' : ''}`}>
          <input value={form.guardian_relation} onChange={set('guardian_relation')} placeholder="mẹ, bố, ông…" required={child || Boolean(form.guardian_name)} />
        </Field>
        <Field label="Số hồ sơ giấy cũ"><input value={form.paper_record_no} onChange={set('paper_record_no')} placeholder="HS-2019-…" /></Field>
        <Field label="Địa chỉ"><input value={form.address} onChange={set('address')} /></Field>
      </div>
      <div className="mt">
        <Field label="Tiền sử, dị ứng"><textarea value={form.medical_note} onChange={set('medical_note')} /></Field>
      </div>
      {initial && (
        <label className="check mt"><input type="checkbox" checked={form.is_active} onChange={set('is_active')} /> Hồ sơ đang hoạt động (không xóa hồ sơ — giữ 5 năm)</label>
      )}
      <div className="row mt">
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Đang lưu…' : submitLabel}</button>
      </div>
    </form>
  );
}
