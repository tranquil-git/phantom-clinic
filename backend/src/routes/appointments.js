// UC20 – UC29: lịch hẹn, khung trống, đặt / đổi / hủy, tiếp đón, không đến, khách không hẹn, nhắc hẹn
import { Router } from 'express';
import { authorize, can } from '../auth.js';
import { query, queryOne, tx } from '../db.js';
import { HttpError } from '../errors.js';
import { addDays, date, id, oneOf, optId, optText, time, todayLocal } from '../validate.js';

export const appointmentsRouter = Router();
export const remindersRouter = Router();

const LIST_SQL = `
  SELECT a.id, a.appt_date, a.slot_time, a.status, a.note, a.checked_in_at, a.cancel_note, a.cancelled_at,
         p.id AS patient_id, p.full_name AS patient_name, p.contact_phone,
         d.id AS doctor_id, d.full_name AS doctor_name,
         c.id AS chair_id, c.name AS chair_name,
         sv.id AS service_id, sv.name AS service_name,
         cr.name AS cancel_reason, cb.full_name AS cancelled_by_name,
         r.id AS record_id
  FROM appointment a
  JOIN patient p ON p.id = a.patient_id
  JOIN staff d ON d.id = a.doctor_id
  JOIN chair c ON c.id = a.chair_id
  JOIN service sv ON sv.id = a.planned_service_id
  LEFT JOIN cancel_reason cr ON cr.id = a.cancel_reason_id
  LEFT JOIN staff cb ON cb.id = a.cancelled_by
  LEFT JOIN treatment_record r ON r.appointment_id = a.id`;

async function getAppointment(client, appointmentId) {
  const { rows } = await client.query('SELECT * FROM appointment WHERE id = $1 FOR UPDATE', [appointmentId]);
  if (!rows[0]) throw new HttpError(404, 'Không tìm thấy lịch hẹn');
  return rows[0];
}

// Ghế còn trống ở một khung (bỏ qua chính lịch đang đổi)
async function freeChair(client, apptDate, slotTime, exceptId = null) {
  const { rows } = await client.query(`
    SELECT c.id FROM chair c
    WHERE c.is_active AND NOT EXISTS (
      SELECT 1 FROM appointment a
      WHERE a.chair_id = c.id AND a.appt_date = $1 AND a.slot_time = $2
        AND a.status <> 'cancelled' AND a.id IS DISTINCT FROM $3)
    ORDER BY c.id LIMIT 1`, [apptDate, slotTime, exceptId]);
  if (!rows[0]) throw new HttpError(409, 'Hết ghế trống ở khung giờ này');
  return rows[0].id;
}

// UC20
appointmentsRouter.get('/', authorize('appointment.read'), async (req, res) => {
  const day = date(req.query.date ?? todayLocal(), 'Ngày');
  const doctorId = optId(req.query.doctor_id, 'Bác sĩ');
  res.json(await query(`${LIST_SQL}
    WHERE a.appt_date = $1 AND ($2::bigint IS NULL OR a.doctor_id = $2)
    ORDER BY a.slot_time, c.id`, [day, doctorId]));
});

// UC21: khung có bác sĩ đang trực, bác sĩ còn rảnh và còn ít nhất một ghế (LN-03, LN-11)
appointmentsRouter.get('/slots', authorize('appointment.create'), async (req, res) => {
  const day = date(req.query.date, 'Ngày');
  const doctorId = optId(req.query.doctor_id, 'Bác sĩ');
  const exceptId = optId(req.query.except_id, 'Lịch hẹn');
  res.json(await query(`
    WITH free AS (
      SELECT sl.slot_time, d.id AS doctor_id, d.full_name AS doctor_name,
             ARRAY(SELECT c.id FROM chair c
                   WHERE c.is_active AND NOT EXISTS (
                     SELECT 1 FROM appointment a
                     WHERE a.chair_id = c.id AND a.appt_date = $1 AND a.slot_time = sl.slot_time
                       AND a.status <> 'cancelled' AND a.id IS DISTINCT FROM $3)
                   ORDER BY c.id) AS free_chairs
      FROM clinic_slots($1, $1) sl
      JOIN doctor_shift sh ON sh.shift_date = $1
                          AND sl.slot_time >= sh.start_time
                          AND sl.slot_time + interval '30 minutes' <= sh.end_time
      JOIN staff d ON d.id = sh.doctor_id AND d.is_active
      WHERE ($2::bigint IS NULL OR d.id = $2)
        AND NOT EXISTS (
          SELECT 1 FROM appointment a
          WHERE a.doctor_id = d.id AND a.appt_date = $1 AND a.slot_time = sl.slot_time
            AND a.status <> 'cancelled' AND a.id IS DISTINCT FROM $3)
    )
    SELECT * FROM free WHERE cardinality(free_chairs) > 0
    ORDER BY slot_time, doctor_name`, [day, doctorId, exceptId]));
});

// UC22 (+ UC29 khách không hẹn: walk_in = true → check-in luôn)
appointmentsRouter.post('/', authorize('appointment.create'), async (req, res) => {
  const b = req.body ?? {};
  const patientId = id(b.patient_id, 'Bệnh nhân');
  const doctorId = id(b.doctor_id, 'Bác sĩ');
  const serviceId = id(b.planned_service_id, 'Việc cần làm');
  const apptDate = date(b.appt_date, 'Ngày hẹn');
  const slotTime = time(b.slot_time, 'Khung giờ');
  const walkIn = b.walk_in === true;
  const today = todayLocal();
  if (apptDate < today) throw new HttpError(400, 'Không đặt lịch vào ngày đã qua');
  if (walkIn && apptDate !== today) throw new HttpError(400, 'Khách không hẹn chỉ tiếp nhận trong ngày');
  if (walkIn && !can(req, 'appointment.walk_in')) throw new HttpError(403, 'Không có quyền appointment.walk_in (tiếp nhận khách không hẹn)');

  const row = await tx(req.user.id, async (client) => {
    const { rows: [patient] } = await client.query('SELECT is_active FROM patient WHERE id = $1', [patientId]);
    if (!patient?.is_active) throw new HttpError(400, 'Bệnh nhân không tồn tại hoặc đã ngừng hoạt động');
    const chairId = b.chair_id ? id(b.chair_id, 'Ghế') : await freeChair(client, apptDate, slotTime);
    const { rows } = await client.query(`
      INSERT INTO appointment (patient_id, doctor_id, chair_id, appt_date, slot_time, planned_service_id,
                               note, status, checked_in_at, booked_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [patientId, doctorId, chairId, apptDate, slotTime, serviceId, optText(b.note),
      walkIn ? 'checked_in' : 'booked', walkIn ? new Date() : null, req.user.id]);
    return rows[0];
  });
  res.status(201).json(row);
});

// UC23
appointmentsRouter.post('/:id/reschedule', authorize('appointment.manage'), async (req, res) => {
  const b = req.body ?? {};
  const doctorId = id(b.doctor_id, 'Bác sĩ');
  const apptDate = date(b.appt_date, 'Ngày hẹn');
  const slotTime = time(b.slot_time, 'Khung giờ');
  if (apptDate < todayLocal()) throw new HttpError(400, 'Không dời lịch về ngày đã qua');
  await tx(req.user.id, async (client) => {
    const appt = await getAppointment(client, req.params.id);
    if (appt.status !== 'booked') throw new HttpError(409, 'Chỉ đổi được lịch đang ở trạng thái đã đặt');
    const chairId = await freeChair(client, apptDate, slotTime, appt.id);
    await client.query(`
      UPDATE appointment SET doctor_id = $1, appt_date = $2, slot_time = $3, chair_id = $4,
             note = COALESCE($5, note)
      WHERE id = $6`, [doctorId, apptDate, slotTime, chairId, optText(b.note), appt.id]);
  });
  res.json({ ok: true });
});

// UC24 (LN-10: lý do, ai hủy, lúc nào)
appointmentsRouter.post('/:id/cancel', authorize('appointment.manage'), async (req, res) => {
  const reasonId = id(req.body?.cancel_reason_id, 'Lý do hủy');
  await tx(req.user.id, async (client) => {
    const appt = await getAppointment(client, req.params.id);
    if (appt.status !== 'booked') throw new HttpError(409, 'Chỉ hủy được lịch chưa tiếp đón');
    await client.query(`
      UPDATE appointment SET status = 'cancelled', cancel_reason_id = $1, cancel_note = $2,
             cancelled_by = $3, cancelled_at = now()
      WHERE id = $4`, [reasonId, optText(req.body?.cancel_note), req.user.id, appt.id]);
  });
  res.json({ ok: true });
});

// UC27
appointmentsRouter.post('/:id/check-in', authorize('appointment.manage'), async (req, res) => {
  await tx(req.user.id, async (client) => {
    const appt = await getAppointment(client, req.params.id);
    if (appt.status !== 'booked') throw new HttpError(409, 'Lịch này không ở trạng thái chờ tiếp đón');
    if (appt.appt_date !== todayLocal()) throw new HttpError(409, 'Chỉ tiếp đón lịch của hôm nay');
    const chairId = optId(req.body?.chair_id, 'Ghế') ?? appt.chair_id;
    await client.query(`
      UPDATE appointment SET status = 'checked_in', checked_in_at = now(), chair_id = $1 WHERE id = $2`,
    [chairId, appt.id]);
  });
  res.json({ ok: true });
});

// UC28
appointmentsRouter.post('/:id/no-show', authorize('appointment.manage'), async (req, res) => {
  await tx(req.user.id, async (client) => {
    const appt = await getAppointment(client, req.params.id);
    if (appt.status !== 'booked') throw new HttpError(409, 'Lịch này không ở trạng thái chờ tiếp đón');
    if (appt.appt_date > todayLocal()) throw new HttpError(409, 'Chưa tới ngày hẹn');
    await client.query("UPDATE appointment SET status = 'no_show' WHERE id = $1", [appt.id]);
  });
  res.json({ ok: true });
});

// UC25: danh sách hẹn cần nhắc (mặc định ngày mai) kèm nhật ký nhắc
remindersRouter.get('/', authorize('reminder.manage'), async (req, res) => {
  const day = date(req.query.date ?? addDays(todayLocal(), 1), 'Ngày');
  res.json(await query(`
    SELECT a.id, a.appt_date, a.slot_time, p.id AS patient_id, p.full_name AS patient_name, p.contact_phone,
           d.id AS doctor_id, d.full_name AS doctor_name, sv.name AS service_name, c.name AS chair_name,
           COALESCE(json_agg(json_build_object(
             'channel', ar.channel, 'result', ar.result, 'note', ar.note,
             'created_at', ar.created_at, 'by', s.full_name) ORDER BY ar.created_at)
             FILTER (WHERE ar.id IS NOT NULL), '[]') AS reminders
    FROM appointment a
    JOIN patient p ON p.id = a.patient_id
    JOIN staff d ON d.id = a.doctor_id
    JOIN service sv ON sv.id = a.planned_service_id
    JOIN chair c ON c.id = a.chair_id
    LEFT JOIN appointment_reminder ar ON ar.appointment_id = a.id
    LEFT JOIN staff s ON s.id = ar.created_by
    WHERE a.appt_date = $1 AND a.status = 'booked'
    GROUP BY a.id, p.id, d.id, sv.id, c.id
    ORDER BY a.slot_time, c.id`, [day]));
});

// Chưa nối cổng SMS thật: ghi log và coi như đã gửi (GT-06)
function sendSms(phone, message) {
  console.log(`[SMS giả lập] ${phone}: ${message}`);
  return true;
}

// UC25 ghi kết quả gọi, UC26 gửi tin nhắn
remindersRouter.post('/', authorize('reminder.manage'), async (req, res) => {
  const b = req.body ?? {};
  const appointmentId = id(b.appointment_id, 'Lịch hẹn');
  const channel = oneOf(b.channel, ['call', 'sms'], 'Kênh nhắc');
  const appt = await queryOne(`${LIST_SQL} WHERE a.id = $1`, [appointmentId]);
  if (!appt) throw new HttpError(404, 'Không tìm thấy lịch hẹn');
  if (appt.status !== 'booked') throw new HttpError(409, 'Lịch này không còn chờ nhắc');

  let result;
  if (channel === 'call') {
    result = oneOf(b.result, ['confirmed', 'wants_reschedule', 'wants_cancel', 'no_answer'], 'Kết quả gọi');
  } else {
    const message = `Nha khoa Nu Cuoi Viet nhac lich: ${appt.patient_name}, ${appt.slot_time} ngay `
      + `${appt.appt_date.split('-').reverse().join('/')}, ${appt.doctor_name}.`;
    result = sendSms(appt.contact_phone, message) ? 'sms_sent' : 'sms_failed';
  }
  const row = await queryOne(`
    INSERT INTO appointment_reminder (appointment_id, channel, result, note, created_by)
    VALUES ($1, $2, $3, $4, $5) RETURNING *`, [appointmentId, channel, result, optText(b.note), req.user.id]);
  res.status(201).json(row);
});
