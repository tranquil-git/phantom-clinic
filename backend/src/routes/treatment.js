// UC30 – UC36: danh sách chờ khám, phiếu điều trị, dòng việc, đơn thuốc, liệu trình, lịch sử sửa
import { Router } from 'express';
import { ALL_ROLES, DENTIST, MANAGER, requireRole } from '../auth.js';
import { query, queryOne, tx } from '../db.js';
import { HttpError } from '../errors.js';
import { assertBillingOpen, rebuildInvoice } from '../invoicing.js';
import { date, id, money, oneOf, optId, optText, quantity, text, todayLocal } from '../validate.js';

export const treatmentRouter = Router();

const TOOTH_RE = /^(0[0-2]|[1-4][1-8]|[5-8][1-5])$/;

function tooth(v) {
  const s = String(v ?? '').trim().padStart(2, '0');
  if (!TOOTH_RE.test(s)) {
    throw new HttpError(400, 'Số răng không hợp lệ (FDI 11–48, 51–85; 00 cả miệng, 01 hàm trên, 02 hàm dưới)');
  }
  return s;
}

// Phiếu + bệnh nhân, khóa dòng phiếu để sửa tuần tự
async function lockRecord(client, recordId) {
  const { rows } = await client.query(`
    SELECT r.*, a.patient_id, a.doctor_id AS primary_doctor_id, a.appt_date
    FROM treatment_record r JOIN appointment a ON a.id = r.appointment_id
    WHERE r.id = $1 FOR UPDATE OF r`, [recordId]);
  if (!rows[0]) throw new HttpError(404, 'Không tìm thấy phiếu điều trị');
  return rows[0];
}

// GT-16: bác sĩ chỉ sửa phiếu do mình lập
function assertOwner(record, user) {
  if (record.created_by !== user.id) throw new HttpError(403, 'Chỉ bác sĩ lập phiếu mới sửa được phiếu này');
}

// UC30
treatmentRouter.get('/queue', requireRole(DENTIST, MANAGER), async (req, res) => {
  const day = date(req.query.date ?? todayLocal(), 'Ngày');
  res.json(await query(`
    SELECT a.id AS appointment_id, a.slot_time, a.checked_in_at, p.id AS patient_id, p.full_name AS patient_name,
           p.date_of_birth, p.medical_note, d.id AS doctor_id, d.full_name AS doctor_name, c.name AS chair_name,
           sv.name AS service_name, r.id AS record_id, r.created_by AS record_created_by,
           (SELECT count(*) FROM treatment_line tl WHERE tl.record_id = r.id) AS line_count
    FROM appointment a
    JOIN patient p ON p.id = a.patient_id
    JOIN staff d ON d.id = a.doctor_id
    JOIN chair c ON c.id = a.chair_id
    JOIN service sv ON sv.id = a.planned_service_id
    LEFT JOIN treatment_record r ON r.appointment_id = a.id
    WHERE a.appt_date = $1 AND a.status = 'checked_in'
    ORDER BY (r.id IS NOT NULL), a.checked_in_at`, [day]));
});

// UC31: mở phiếu cho lịch đã check-in
treatmentRouter.post('/records', requireRole(DENTIST), async (req, res) => {
  const appointmentId = id(req.body?.appointment_id, 'Lịch hẹn');
  const row = await tx(req.user.id, async (client) => {
    const { rows: [appt] } = await client.query(
      'SELECT status FROM appointment WHERE id = $1 FOR UPDATE', [appointmentId]);
    if (!appt) throw new HttpError(404, 'Không tìm thấy lịch hẹn');
    if (appt.status !== 'checked_in') throw new HttpError(409, 'Bệnh nhân chưa được tiếp đón');
    const { rows: [existing] } = await client.query(
      'SELECT id FROM treatment_record WHERE appointment_id = $1', [appointmentId]);
    if (existing) return existing;
    const { rows } = await client.query(
      'INSERT INTO treatment_record (appointment_id, created_by) VALUES ($1, $2) RETURNING id',
      [appointmentId, req.user.id]);
    return rows[0];
  });
  res.status(201).json(row);
});

treatmentRouter.get('/records/:id', requireRole(...ALL_ROLES), async (req, res) => {
  const record = await queryOne(`
    SELECT r.id, r.diagnosis, r.note, r.created_by, r.created_at, cb.full_name AS created_by_name,
           a.id AS appointment_id, a.appt_date, a.slot_time, c.name AS chair_name,
           a.doctor_id AS primary_doctor_id, d.full_name AS primary_doctor_name,
           p.id AS patient_id, p.full_name AS patient_name, p.date_of_birth, p.contact_phone, p.medical_note
    FROM treatment_record r
    JOIN appointment a ON a.id = r.appointment_id
    JOIN chair c ON c.id = a.chair_id
    JOIN staff d ON d.id = a.doctor_id
    JOIN staff cb ON cb.id = r.created_by
    JOIN patient p ON p.id = a.patient_id
    WHERE r.id = $1`, [req.params.id]);
  if (!record) throw new HttpError(404, 'Không tìm thấy phiếu điều trị');

  const [lines, prescriptions, plans, invoice, audit] = await Promise.all([
    query(`
      SELECT tl.id, tl.service_id, sv.name AS service_name, tl.tooth_code, tl.doctor_id, d.full_name AS doctor_name,
             tl.plan_id, tl.session_no, tl.note, psv.name AS plan_name,
             service_price_at(tl.service_id, $2) AS unit_price
      FROM treatment_line tl
      JOIN service sv ON sv.id = tl.service_id
      JOIN staff d ON d.id = tl.doctor_id
      LEFT JOIN treatment_plan tp ON tp.id = tl.plan_id
      LEFT JOIN service psv ON psv.id = tp.service_id
      WHERE tl.record_id = $1 ORDER BY tl.id`, [req.params.id, record.appt_date]),
    query(`
      SELECT pi.id, pi.item_id, it.name AS item_name, it.unit, pi.dosage, pi.quantity, pi.dispensed_in_clinic
      FROM prescription_item pi JOIN inventory_item it ON it.id = pi.item_id
      WHERE pi.record_id = $1 ORDER BY pi.id`, [req.params.id]),
    query(`
      SELECT pp.plan_id, sv.name AS service_name, pp.status, pp.planned_sessions, pp.sessions_done
      FROM plan_progress pp JOIN service sv ON sv.id = pp.service_id
      WHERE pp.patient_id = $1 AND pp.status = 'active' ORDER BY pp.plan_id`, [record.patient_id]),
    queryOne(`
      SELECT b.invoice_id, b.total, b.paid, b.remaining
      FROM invoice_balance b JOIN invoice i ON i.id = b.invoice_id WHERE i.record_id = $1`, [req.params.id]),
    query(`
      SELECT al.id, al.table_name, al.row_id, al.action, al.old_data, al.new_data, al.reason, al.changed_at,
             s.full_name AS changed_by_name
      FROM audit_log al JOIN staff s ON s.id = al.changed_by
      WHERE al.record_id = $1 ORDER BY al.changed_at DESC, al.id DESC`, [req.params.id]),
  ]);
  const canEdit = req.user.role === DENTIST && record.created_by === req.user.id;
  res.json({ record, lines, prescriptions, plans, invoice, audit, canEdit });
});

// UC35: sửa chẩn đoán / ghi chú
treatmentRouter.put('/records/:id', requireRole(DENTIST), async (req, res) => {
  const reason = optText(req.body?.reason);
  await tx(req.user.id, async (client) => {
    const record = await lockRecord(client, req.params.id);
    assertOwner(record, req.user);
    await client.query('UPDATE treatment_record SET diagnosis = $1, note = $2 WHERE id = $3',
      [optText(req.body?.diagnosis), optText(req.body?.note), record.id]);
  }, reason);
  res.json({ ok: true });
});

// UC31 thêm việc; UC33 ghi buổi vào liệu trình (tự đánh buổi thứ n)
treatmentRouter.post('/records/:id/lines', requireRole(DENTIST), async (req, res) => {
  const b = req.body ?? {};
  const serviceId = id(b.service_id, 'Dịch vụ');
  const toothCode = tooth(b.tooth_code);
  const planId = optId(b.plan_id, 'Liệu trình');
  const row = await tx(req.user.id, async (client) => {
    const record = await lockRecord(client, req.params.id);
    assertOwner(record, req.user);
    const doctorId = optId(b.doctor_id, 'Bác sĩ thực hiện') ?? record.primary_doctor_id;
    let sessionNo = null;
    if (planId) {
      const { rows: [plan] } = await client.query(
        'SELECT patient_id, status FROM treatment_plan WHERE id = $1 FOR UPDATE', [planId]);
      if (!plan || plan.patient_id !== record.patient_id) throw new HttpError(400, 'Liệu trình không thuộc bệnh nhân này');
      if (plan.status !== 'active') throw new HttpError(409, 'Liệu trình đã đóng');
      const { rows: [n] } = await client.query(`
        SELECT COALESCE(
          (SELECT session_no FROM treatment_line WHERE record_id = $1 AND plan_id = $2 LIMIT 1),
          (SELECT COALESCE(max(session_no), 0) + 1 FROM treatment_line WHERE plan_id = $2)) AS n`,
      [record.id, planId]);
      sessionNo = n.n;
    } else {
      await assertBillingOpen(client, record.id);
    }
    const { rows } = await client.query(`
      INSERT INTO treatment_line (record_id, service_id, tooth_code, doctor_id, plan_id, session_no, note)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [record.id, serviceId, toothCode, doctorId, planId, sessionNo, optText(b.note)]);
    await rebuildInvoice(client, record.id);
    return rows[0];
  });
  res.status(201).json(row);
});

treatmentRouter.put('/lines/:id', requireRole(DENTIST), async (req, res) => {
  const b = req.body ?? {};
  await tx(req.user.id, async (client) => {
    const { rows: [line] } = await client.query('SELECT * FROM treatment_line WHERE id = $1', [req.params.id]);
    if (!line) throw new HttpError(404, 'Không tìm thấy dòng việc');
    const record = await lockRecord(client, line.record_id);
    assertOwner(record, req.user);
    const serviceId = id(b.service_id, 'Dịch vụ');
    // Chỉ ghi service_id khi thật sự đổi: trigger khóa dịch vụ trên hóa đơn đã thu chạy theo cột này,
    // còn số răng / ghi chú vẫn sửa được sau khi thu (GT-11)
    if (serviceId !== line.service_id) {
      await client.query('UPDATE treatment_line SET service_id = $1 WHERE id = $2', [serviceId, line.id]);
    }
    await client.query('UPDATE treatment_line SET tooth_code = $1, doctor_id = $2, note = $3 WHERE id = $4',
      [tooth(b.tooth_code), id(b.doctor_id, 'Bác sĩ thực hiện'), optText(b.note), line.id]);
    await rebuildInvoice(client, record.id);
  }, optText(b.reason));
  res.json({ ok: true });
});

treatmentRouter.delete('/lines/:id', requireRole(DENTIST), async (req, res) => {
  await tx(req.user.id, async (client) => {
    const { rows: [line] } = await client.query('SELECT * FROM treatment_line WHERE id = $1', [req.params.id]);
    if (!line) throw new HttpError(404, 'Không tìm thấy dòng việc');
    const record = await lockRecord(client, line.record_id);
    assertOwner(record, req.user);
    if (!line.plan_id) await assertBillingOpen(client, record.id);
    await client.query('DELETE FROM invoice_line WHERE treatment_line_id = $1', [line.id]);
    await client.query('DELETE FROM treatment_line WHERE id = $1', [line.id]);
    await rebuildInvoice(client, record.id);
  }, optText(req.body?.reason));
  res.status(204).end();
});

// UC32
treatmentRouter.post('/records/:id/prescriptions', requireRole(DENTIST), async (req, res) => {
  const b = req.body ?? {};
  const dispensed = b.dispensed_in_clinic === true;
  const row = await tx(req.user.id, async (client) => {
    const record = await lockRecord(client, req.params.id);
    assertOwner(record, req.user);
    if (dispensed) await assertBillingOpen(client, record.id);
    const { rows } = await client.query(`
      INSERT INTO prescription_item (record_id, item_id, dosage, quantity, dispensed_in_clinic)
      VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [record.id, id(b.item_id, 'Thuốc'), text(b.dosage, 'liều dùng'), quantity(b.quantity, 'Số lượng'), dispensed]);
    await rebuildInvoice(client, record.id);
    return rows[0];
  });
  res.status(201).json(row);
});

treatmentRouter.delete('/prescriptions/:id', requireRole(DENTIST), async (req, res) => {
  await tx(req.user.id, async (client) => {
    const { rows: [item] } = await client.query('SELECT * FROM prescription_item WHERE id = $1', [req.params.id]);
    if (!item) throw new HttpError(404, 'Không tìm thấy thuốc trong đơn');
    const record = await lockRecord(client, item.record_id);
    assertOwner(record, req.user);
    if (item.dispensed_in_clinic) await assertBillingOpen(client, record.id);
    await client.query('DELETE FROM invoice_line WHERE prescription_item_id = $1', [item.id]);
    await client.query('DELETE FROM prescription_item WHERE id = $1', [item.id]);
    await rebuildInvoice(client, record.id);
  }, optText(req.body?.reason));
  res.status(204).end();
});

// ---------------------------------------------------------------------
// Liệu trình (UC34, UC76)
// ---------------------------------------------------------------------
treatmentRouter.get('/plans', requireRole(...ALL_ROLES), async (req, res) => {
  const status = req.query.status ? oneOf(req.query.status, ['active', 'completed', 'cancelled'], 'Trạng thái') : null;
  res.json(await query(`
    SELECT pp.*, p.full_name AS patient_name, p.contact_phone, sv.name AS service_name, s.full_name AS doctor_name,
           (SELECT json_build_object('installment_no', pi.installment_no, 'amount', pi.amount, 'due_date', pi.due_date)
            FROM plan_installment pi
            WHERE pi.plan_id = pp.plan_id AND NOT EXISTS (SELECT 1 FROM invoice i WHERE i.installment_id = pi.id)
            ORDER BY pi.installment_no LIMIT 1) AS next_installment
    FROM plan_progress pp
    JOIN patient p ON p.id = pp.patient_id
    JOIN service sv ON sv.id = pp.service_id
    JOIN staff s ON s.id = pp.doctor_id
    WHERE $1::plan_status IS NULL OR pp.status = $1
    ORDER BY pp.status, pp.sessions_left, p.full_name`, [status]));
});

treatmentRouter.get('/plans/:id', requireRole(...ALL_ROLES), async (req, res) => {
  const plan = await queryOne(`
    SELECT pp.*, tp.started_on, tp.closed_on, tp.note, p.full_name AS patient_name, p.contact_phone,
           sv.name AS service_name, s.full_name AS doctor_name
    FROM plan_progress pp
    JOIN treatment_plan tp ON tp.id = pp.plan_id
    JOIN patient p ON p.id = pp.patient_id
    JOIN service sv ON sv.id = pp.service_id
    JOIN staff s ON s.id = pp.doctor_id
    WHERE pp.plan_id = $1`, [req.params.id]);
  if (!plan) throw new HttpError(404, 'Không tìm thấy liệu trình');
  const [installments, sessions, audit] = await Promise.all([
    query(`
      SELECT pi.id, pi.installment_no, pi.amount, pi.due_date, b.invoice_id, b.paid, b.remaining
      FROM plan_installment pi
      LEFT JOIN invoice i ON i.installment_id = pi.id
      LEFT JOIN invoice_balance b ON b.invoice_id = i.id
      WHERE pi.plan_id = $1 ORDER BY pi.installment_no`, [req.params.id]),
    query(`
      SELECT tl.session_no, r.id AS record_id, a.appt_date, d.full_name AS doctor_name,
             string_agg(sv.name || ' (' || tl.tooth_code || ')', ', ' ORDER BY tl.id) AS work
      FROM treatment_line tl
      JOIN treatment_record r ON r.id = tl.record_id
      JOIN appointment a ON a.id = r.appointment_id
      JOIN staff d ON d.id = tl.doctor_id
      JOIN service sv ON sv.id = tl.service_id
      WHERE tl.plan_id = $1
      GROUP BY tl.session_no, r.id, a.appt_date, d.full_name
      ORDER BY tl.session_no`, [req.params.id]),
    query(`
      SELECT al.action, al.old_data, al.new_data, al.reason, al.changed_at, s.full_name AS changed_by_name
      FROM audit_log al JOIN staff s ON s.id = al.changed_by
      WHERE al.table_name = 'treatment_plan' AND al.row_id = $1 ORDER BY al.changed_at DESC`, [req.params.id]),
  ]);
  res.json({ plan, installments, sessions, audit });
});

// UC34: tổng các đợt phải bằng tổng giá (GT-23)
treatmentRouter.post('/plans', requireRole(DENTIST), async (req, res) => {
  const b = req.body ?? {};
  const total = money(b.total_price, 'Tổng giá', 1);
  const sessions = id(b.planned_sessions, 'Số buổi dự kiến');
  const installments = Array.isArray(b.installments) ? b.installments : [];
  if (installments.length === 0) throw new HttpError(400, 'Cần ít nhất một đợt trả tiền');
  const parsed = installments.map((x, i) => ({
    amount: money(x.amount, `Số tiền đợt ${i + 1}`, 1),
    due_date: date(x.due_date, `Hạn đợt ${i + 1}`),
  }));
  const sum = parsed.reduce((s, x) => s + x.amount, 0);
  if (sum !== total) throw new HttpError(400, `Tổng các đợt (${sum.toLocaleString('vi-VN')}) phải bằng tổng giá (${total.toLocaleString('vi-VN')})`);

  const row = await tx(req.user.id, async (client) => {
    const { rows: [plan] } = await client.query(`
      INSERT INTO treatment_plan (patient_id, service_id, doctor_id, total_price, planned_sessions, note, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $3) RETURNING id`,
    [id(b.patient_id, 'Bệnh nhân'), id(b.service_id, 'Loại liệu trình'), req.user.id, total, sessions, optText(b.note)]);
    for (const [i, x] of parsed.entries()) {
      await client.query(
        'INSERT INTO plan_installment (plan_id, installment_no, amount, due_date) VALUES ($1, $2, $3, $4)',
        [plan.id, i + 1, x.amount, x.due_date]);
    }
    return plan;
  });
  res.status(201).json(row);
});

// Đổi số buổi dự kiến / đóng liệu trình — có ghi lịch sử
treatmentRouter.patch('/plans/:id', requireRole(DENTIST), async (req, res) => {
  const b = req.body ?? {};
  await tx(req.user.id, async (client) => {
    const { rows: [plan] } = await client.query('SELECT * FROM treatment_plan WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!plan) throw new HttpError(404, 'Không tìm thấy liệu trình');
    if (plan.doctor_id !== req.user.id) throw new HttpError(403, 'Chỉ bác sĩ phụ trách mới sửa được liệu trình');
    const status = b.status ? oneOf(b.status, ['active', 'completed', 'cancelled'], 'Trạng thái') : plan.status;
    const sessions = b.planned_sessions ? id(b.planned_sessions, 'Số buổi dự kiến') : plan.planned_sessions;
    await client.query(`
      UPDATE treatment_plan SET planned_sessions = $1, status = $2,
             closed_on = CASE WHEN $2 = 'active' THEN NULL ELSE COALESCE(closed_on, local_date(now())) END,
             note = COALESCE($3, note)
      WHERE id = $4`, [sessions, status, optText(b.note), plan.id]);
  }, optText(b.reason));
  res.json({ ok: true });
});
