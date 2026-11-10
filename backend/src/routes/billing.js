// UC41 – UC45: lập hóa đơn lượt khám / đợt liệu trình, giảm giá, thu tiền, chốt két
import { Router } from 'express';
import { authorize } from '../auth.js';
import { pool, query, queryOne, tx } from '../db.js';
import { HttpError } from '../errors.js';
import { billableLines, insertLine } from '../invoicing.js';
import { date, id, money, oneOf, optText, todayLocal } from '../validate.js';

export const billingRouter = Router();

const PATIENT_OF_RECORD = `
  SELECT p.id AS patient_id, p.full_name AS patient_name, p.contact_phone, a.appt_date, a.slot_time,
         d.full_name AS doctor_name, c.name AS chair_name
  FROM treatment_record r
  JOIN appointment a ON a.id = r.appointment_id
  JOIN patient p ON p.id = a.patient_id
  JOIN staff d ON d.id = a.doctor_id
  JOIN chair c ON c.id = a.chair_id
  WHERE r.id = $1`;

// Phiếu chờ lập hóa đơn + đợt liệu trình chưa lập hóa đơn
billingRouter.get('/billing/pending', authorize('invoice.list'), async (req, res) => {
  const [records, installments] = await Promise.all([
    query(`
      SELECT r.id AS record_id, a.appt_date, a.slot_time, p.id AS patient_id, p.full_name AS patient_name,
             p.contact_phone, d.full_name AS doctor_name,
             (SELECT count(*) FROM treatment_line tl WHERE tl.record_id = r.id AND tl.plan_id IS NULL)
           + (SELECT count(*) FROM prescription_item pi WHERE pi.record_id = r.id AND pi.dispensed_in_clinic) AS line_count
      FROM treatment_record r
      JOIN appointment a ON a.id = r.appointment_id
      JOIN patient p ON p.id = a.patient_id
      JOIN staff d ON d.id = a.doctor_id
      WHERE NOT EXISTS (SELECT 1 FROM invoice i WHERE i.record_id = r.id)
        AND (EXISTS (SELECT 1 FROM treatment_line tl WHERE tl.record_id = r.id AND tl.plan_id IS NULL)
          OR EXISTS (SELECT 1 FROM prescription_item pi WHERE pi.record_id = r.id AND pi.dispensed_in_clinic))
      ORDER BY a.appt_date DESC, a.slot_time DESC`),
    query(`
      SELECT pi.id AS installment_id, pi.installment_no, pi.amount, pi.due_date, tp.id AS plan_id,
             p.id AS patient_id, p.full_name AS patient_name, p.contact_phone, sv.name AS service_name
      FROM plan_installment pi
      JOIN treatment_plan tp ON tp.id = pi.plan_id
      JOIN patient p ON p.id = tp.patient_id
      JOIN service sv ON sv.id = tp.service_id
      WHERE tp.status = 'active' AND NOT EXISTS (SELECT 1 FROM invoice i WHERE i.installment_id = pi.id)
      ORDER BY pi.due_date, p.full_name`),
  ]);
  res.json({ records, installments });
});

billingRouter.get('/billing/preview/:recordId', authorize('invoice.create'), async (req, res) => {
  const head = await queryOne(PATIENT_OF_RECORD, [req.params.recordId]);
  if (!head) throw new HttpError(404, 'Không tìm thấy phiếu điều trị');
  const existing = await queryOne('SELECT id FROM invoice WHERE record_id = $1', [req.params.recordId]);
  const lines = await billableLines(pool, req.params.recordId);
  res.json({ ...head, record_id: Number(req.params.recordId), invoice_id: existing?.id ?? null, lines });
});

// UC41 + UC43: giảm theo dòng và / hoặc ở tổng; giảm ở tổng phân bổ xuống dòng (mục 3.3)
billingRouter.post('/invoices', authorize('invoice.create'), async (req, res) => {
  const b = req.body ?? {};
  const recordId = id(b.record_id, 'Phiếu điều trị');
  const totalDiscount = money(b.total_discount ?? 0, 'Giảm ở tổng');
  const lineDiscounts = b.line_discounts ?? {};
  const discountReason = optText(b.discount_reason);

  const row = await tx(req.user.id, async (client) => {
    await client.query('SELECT id FROM treatment_record WHERE id = $1 FOR UPDATE', [recordId]);
    const lines = await billableLines(client, recordId);
    if (lines.length === 0) throw new HttpError(409, 'Phiếu không có dòng nào phải tính tiền');

    for (const l of lines) {
      const key = l.treatment_line_id ? `t${l.treatment_line_id}` : `p${l.prescription_item_id}`;
      l.discount = money(lineDiscounts[key] ?? 0, `Giảm giá "${l.description}"`);
      if (l.discount > l.gross) throw new HttpError(400, `Giảm giá "${l.description}" lớn hơn thành tiền`);
    }
    const afterLine = lines.reduce((s, l) => s + l.gross - l.discount, 0);
    if (totalDiscount > afterLine) throw new HttpError(400, 'Giảm ở tổng lớn hơn số tiền phải trả');
    if ((totalDiscount > 0 || lines.some((l) => l.discount > 0)) && !discountReason) {
      throw new HttpError(400, 'Nhập lý do giảm giá');
    }
    // Phân bổ theo tỷ lệ, phần lẻ dồn vào dòng cuối còn tiền
    let left = totalDiscount;
    const payable = lines.filter((l) => l.gross - l.discount > 0);
    payable.forEach((l, i) => {
      const share = i === payable.length - 1
        ? left
        : Math.min(left, Math.round((totalDiscount * (l.gross - l.discount)) / afterLine));
      l.discount += share;
      left -= share;
    });

    const { rows: [invoice] } = await client.query(`
      INSERT INTO invoice (kind, record_id, total_discount_amount, discount_reason, created_by)
      VALUES ('visit', $1, $2, $3, $4) RETURNING id`, [recordId, totalDiscount, discountReason, req.user.id]);
    for (const l of lines) await insertLine(client, invoice.id, l, l.discount);
    return invoice;
  });
  res.status(201).json(row);
});

// UC42
billingRouter.post('/invoices/installment', authorize('invoice.create'), async (req, res) => {
  const installmentId = id(req.body?.installment_id, 'Đợt liệu trình');
  const row = await tx(req.user.id, async (client) => {
    const { rows: [inst] } = await client.query(`
      SELECT pi.*, tp.doctor_id, tp.status, sv.name AS service_name
      FROM plan_installment pi
      JOIN treatment_plan tp ON tp.id = pi.plan_id
      JOIN service sv ON sv.id = tp.service_id
      WHERE pi.id = $1 FOR UPDATE OF pi`, [installmentId]);
    if (!inst) throw new HttpError(404, 'Không tìm thấy đợt liệu trình');
    if (inst.status === 'cancelled') throw new HttpError(409, 'Liệu trình đã hủy');
    const { rows: [invoice] } = await client.query(`
      INSERT INTO invoice (kind, installment_id, created_by) VALUES ('installment', $1, $2) RETURNING id`,
    [installmentId, req.user.id]);
    await client.query(`
      INSERT INTO invoice_line (invoice_id, description, unit_price, doctor_id) VALUES ($1, $2, $3, $4)`,
    [invoice.id, `${inst.service_name} — đợt ${inst.installment_no}`, inst.amount, inst.doctor_id]);
    return invoice;
  });
  res.status(201).json(row);
});

billingRouter.get('/invoices', authorize('invoice.list'), async (req, res) => {
  const status = oneOf(req.query.status ?? 'unpaid', ['unpaid', 'paid', 'all'], 'Trạng thái');
  const q = String(req.query.q ?? '').trim();
  res.json(await query(`
    SELECT b.*, p.full_name AS patient_name, p.contact_phone
    FROM invoice_balance b JOIN patient p ON p.id = b.patient_id
    WHERE ($1 = 'all' OR ($1 = 'unpaid' AND b.remaining > 0) OR ($1 = 'paid' AND b.remaining = 0))
      AND ($2 = '' OR p.contact_phone LIKE $2 || '%' OR p.full_name ILIKE '%' || $2 || '%')
    ORDER BY b.created_at DESC LIMIT 200`, [status, q]));
});

billingRouter.get('/invoices/:id', authorize('invoice.read'), async (req, res) => {
  const invoice = await queryOne(`
    SELECT b.*, i.record_id, i.installment_id, i.total_discount_amount, i.discount_reason,
           s.full_name AS created_by_name, p.full_name AS patient_name, p.contact_phone,
           pi.plan_id, pi.installment_no
    FROM invoice_balance b
    JOIN invoice i ON i.id = b.invoice_id
    JOIN staff s ON s.id = i.created_by
    JOIN patient p ON p.id = b.patient_id
    LEFT JOIN plan_installment pi ON pi.id = i.installment_id
    WHERE b.invoice_id = $1`, [req.params.id]);
  if (!invoice) throw new HttpError(404, 'Không tìm thấy hóa đơn');
  const [lines, payments] = await Promise.all([
    query(`
      SELECT l.id, l.description, l.quantity, l.unit_price, l.discount_amount, l.amount, d.full_name AS doctor_name
      FROM invoice_line l LEFT JOIN staff d ON d.id = l.doctor_id
      WHERE l.invoice_id = $1 ORDER BY l.id`, [req.params.id]),
    query(`
      SELECT pm.id, pm.amount, pm.method, pm.received_at, pm.note, s.full_name AS received_by_name
      FROM payment pm JOIN staff s ON s.id = pm.received_by
      WHERE pm.invoice_id = $1 ORDER BY pm.received_at`, [req.params.id]),
  ]);
  res.json({ invoice, lines, payments });
});

// UC44: mỗi lần thu ghi số tiền + hình thức (LN-08); trigger chặn thu quá / ngày đã chốt két
billingRouter.post('/invoices/:id/payments', authorize('payment.create'), async (req, res) => {
  const b = req.body ?? {};
  const row = await tx(req.user.id, async (client) => {
    const { rows } = await client.query(`
      INSERT INTO payment (invoice_id, amount, method, received_by, note)
      VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [req.params.id, money(b.amount, 'Số tiền', 1), oneOf(b.method, ['cash', 'transfer'], 'Hình thức'),
      req.user.id, optText(b.note)]);
    return rows[0];
  });
  res.status(201).json(row);
});

// UC45 / UC79
billingRouter.get('/cash-closing', authorize('cash.read'), async (req, res) => {
  const day = date(req.query.date ?? todayLocal(), 'Ngày');
  const [payments, closing] = await Promise.all([
    query(`
      SELECT pm.id, pm.invoice_id, pm.amount, pm.method, pm.received_at, s.full_name AS received_by_name,
             p.full_name AS patient_name
      FROM payment pm
      JOIN staff s ON s.id = pm.received_by
      JOIN invoice_balance b ON b.invoice_id = pm.invoice_id
      JOIN patient p ON p.id = b.patient_id
      WHERE local_date(pm.received_at) = $1
      ORDER BY pm.received_at`, [day]),
    queryOne(`
      SELECT cc.*, s.full_name AS closed_by_name FROM cash_closing cc JOIN staff s ON s.id = cc.closed_by
      WHERE cc.closing_date = $1`, [day]),
  ]);
  const sum = (m) => payments.filter((p) => p.method === m).reduce((s, p) => s + p.amount, 0);
  res.json({ date: day, cash: sum('cash'), transfer: sum('transfer'), payments, closing });
});

billingRouter.post('/cash-closing', authorize('cash.close'), async (req, res) => {
  const day = date(req.body?.closing_date ?? todayLocal(), 'Ngày');
  if (day > todayLocal()) throw new HttpError(400, 'Không chốt két cho ngày chưa tới');
  const row = await tx(req.user.id, async (client) => {
    const { rows } = await client.query(`
      INSERT INTO cash_closing (closing_date, expected_cash, counted_cash, note, closed_by)
      VALUES ($1, 0, $2, $3, $4) RETURNING *`,
    [day, money(req.body?.counted_cash, 'Tiền đếm được'), optText(req.body?.note), req.user.id]);
    return rows[0];
  });
  res.status(201).json(row);
});
