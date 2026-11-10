// UC10 – UC13: tra cứu, tạo, cập nhật hồ sơ, xem lịch sử điều trị
import { Router } from 'express';
import { authorize } from '../auth.js';
import { query, queryOne } from '../db.js';
import { HttpError } from '../errors.js';
import { ageOn, optDate, optOneOf, optText, text } from '../validate.js';

export const patientsRouter = Router();

function patientInput(b = {}) {
  const p = {
    full_name: text(b.full_name, 'họ tên'),
    date_of_birth: optDate(b.date_of_birth, 'Ngày sinh'),
    gender: optOneOf(b.gender, ['male', 'female', 'other'], 'Giới tính'),
    contact_phone: text(b.contact_phone, 'số điện thoại'),
    guardian_name: optText(b.guardian_name),
    guardian_relation: optText(b.guardian_relation),
    paper_record_no: optText(b.paper_record_no),
    address: optText(b.address),
    medical_note: optText(b.medical_note),
  };
  if (!/^0\d{9,10}$/.test(p.contact_phone)) {
    throw new HttpError(400, 'Số điện thoại phải gồm 10–11 chữ số, bắt đầu bằng 0');
  }
  if (!p.guardian_name !== !p.guardian_relation) {
    throw new HttpError(400, 'Nhập đủ tên và quan hệ của người giám hộ');
  }
  // GT-23: trẻ dưới 15 tuổi dùng SĐT của người giám hộ
  if (p.date_of_birth && ageOn(p.date_of_birth) < 15 && !p.guardian_name) {
    throw new HttpError(400, 'Bệnh nhân dưới 15 tuổi phải có người giám hộ');
  }
  return p;
}

const FIELDS = ['full_name', 'date_of_birth', 'gender', 'contact_phone', 'guardian_name',
  'guardian_relation', 'paper_record_no', 'address', 'medical_note'];

patientsRouter.get('/', authorize('patient.read'), async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const rows = await query(`
    SELECT p.id, p.full_name, p.date_of_birth, p.gender, p.contact_phone, p.guardian_name,
           p.guardian_relation, p.paper_record_no, p.is_active,
           COALESCE(d.debt, 0) AS debt,
           (SELECT max(a.appt_date) FROM appointment a
            JOIN treatment_record r ON r.appointment_id = a.id
            WHERE a.patient_id = p.id) AS last_visit
    FROM patient p
    LEFT JOIN (SELECT patient_id, sum(remaining) AS debt FROM invoice_balance
               WHERE remaining > 0 GROUP BY patient_id) d ON d.patient_id = p.id
    WHERE $1 = '' OR p.contact_phone LIKE $1 || '%' OR p.full_name ILIKE '%' || $1 || '%'
    ORDER BY p.full_name, p.date_of_birth
    LIMIT 100`, [q]);
  res.json(rows);
});

patientsRouter.post('/', authorize('patient.write'), async (req, res) => {
  const p = patientInput(req.body);
  const row = await queryOne(`
    INSERT INTO patient (${FIELDS.join(', ')}, created_by)
    VALUES (${FIELDS.map((_, i) => `$${i + 1}`).join(', ')}, $${FIELDS.length + 1})
    RETURNING id`, [...FIELDS.map((f) => p[f]), req.user.id]);
  res.status(201).json(row);
});

patientsRouter.put('/:id', authorize('patient.write'), async (req, res) => {
  const p = patientInput(req.body);
  const isActive = req.body?.is_active !== false;
  const row = await queryOne(`
    UPDATE patient SET ${FIELDS.map((f, i) => `${f} = $${i + 1}`).join(', ')}, is_active = $${FIELDS.length + 1}
    WHERE id = $${FIELDS.length + 2} RETURNING id`,
  [...FIELDS.map((f) => p[f]), isActive, req.params.id]);
  if (!row) throw new HttpError(404, 'Không tìm thấy bệnh nhân');
  res.json(row);
});

patientsRouter.get('/:id', authorize('patient.read'), async (req, res) => {
  const patient = await queryOne('SELECT * FROM patient WHERE id = $1', [req.params.id]);
  if (!patient) throw new HttpError(404, 'Không tìm thấy bệnh nhân');

  const [appointments, records, plans, invoices, samePhone] = await Promise.all([
    query(`
      SELECT a.id, a.appt_date, a.slot_time, a.status, a.note, a.cancel_note,
             d.full_name AS doctor_name, c.name AS chair_name, sv.name AS service_name,
             cr.name AS cancel_reason, r.id AS record_id
      FROM appointment a
      JOIN staff d ON d.id = a.doctor_id
      JOIN chair c ON c.id = a.chair_id
      JOIN service sv ON sv.id = a.planned_service_id
      LEFT JOIN cancel_reason cr ON cr.id = a.cancel_reason_id
      LEFT JOIN treatment_record r ON r.appointment_id = a.id
      WHERE a.patient_id = $1
      ORDER BY a.appt_date DESC, a.slot_time DESC`, [req.params.id]),
    query(`
      SELECT r.id, a.appt_date, a.slot_time, d.full_name AS doctor_name, r.diagnosis,
             COALESCE(string_agg(sv.name || ' (' || tl.tooth_code || ')', ', ' ORDER BY tl.id), '') AS work
      FROM treatment_record r
      JOIN appointment a ON a.id = r.appointment_id
      JOIN staff d ON d.id = a.doctor_id
      LEFT JOIN treatment_line tl ON tl.record_id = r.id
      LEFT JOIN service sv ON sv.id = tl.service_id
      WHERE a.patient_id = $1
      GROUP BY r.id, a.appt_date, a.slot_time, d.full_name
      ORDER BY a.appt_date DESC, a.slot_time DESC`, [req.params.id]),
    query(`
      SELECT pp.*, sv.name AS service_name, s.full_name AS doctor_name
      FROM plan_progress pp
      JOIN service sv ON sv.id = pp.service_id
      JOIN staff s ON s.id = pp.doctor_id
      WHERE pp.patient_id = $1
      ORDER BY pp.plan_id DESC`, [req.params.id]),
    query(`
      SELECT b.* FROM invoice_balance b WHERE b.patient_id = $1 ORDER BY b.created_at DESC`, [req.params.id]),
    query(`
      SELECT id, full_name, date_of_birth FROM patient
      WHERE contact_phone = $1 AND id <> $2 ORDER BY date_of_birth`, [patient.contact_phone, req.params.id]),
  ]);
  res.json({ patient, appointments, records, plans, invoices, samePhone });
});
