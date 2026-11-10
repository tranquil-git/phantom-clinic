// UC70 – UC79: tám câu quản lý hỏi hằng tháng + đối soát ngày; trang tổng quan
import { Router } from 'express';
import { ALL_ROLES, DENTIST, MANAGER, requireRole } from '../auth.js';
import { query, queryOne } from '../db.js';
import { HttpError } from '../errors.js';
import { addDays, month, todayLocal } from '../validate.js';

export const reportsRouter = Router();

// Mỗi báo cáo: tiêu đề, cột (key, nhãn, kiểu hiển thị) và câu SQL nhận $1 = ngày đầu tháng, $2 = ngày đầu tháng sau
const REPORTS = {
  'revenue-by-doctor': {
    title: 'Q1 — Doanh thu theo bác sĩ (sau giảm giá, theo hóa đơn lập trong tháng)',
    columns: [['doctor', 'Bác sĩ'], ['lines', 'Số dòng', 'number'], ['revenue', 'Doanh thu', 'money', true]],
    chart: { label: 'doctor', value: 'revenue' },
    sql: `
      SELECT s.full_name AS doctor, count(x.amount) AS lines, COALESCE(sum(x.amount), 0) AS revenue
      FROM staff s
      LEFT JOIN (SELECT l.doctor_id, l.amount FROM invoice_line l JOIN invoice i ON i.id = l.invoice_id
                 WHERE local_date(i.created_at) >= $1 AND local_date(i.created_at) < $2) x ON x.doctor_id = s.id
      WHERE s.role = 'dentist'
      GROUP BY s.id ORDER BY revenue DESC, s.full_name`,
  },
  'chair-idle': {
    title: 'Q2 — Ghế trống theo khung giờ (từ đầu tháng đến hôm nay)',
    columns: [['chair', 'Ghế'], ['chair_idle', 'Tổng khung trống của ghế', 'number'], ['slot_time', 'Khung giờ'],
      ['idle', 'Số lần trống', 'number'], ['no_show', 'Khách không đến', 'number']],
    heatmap: { row: 'chair', col: 'slot_time', value: 'idle' },
    sql: `
      WITH k AS (SELECT $1::date AS tu, LEAST($2::date - 1, local_date(now())) AS den),
      kh AS (SELECT c.id AS chair_id, c.name, cs.slot_date, cs.slot_time
             FROM k CROSS JOIN LATERAL clinic_slots(k.tu, k.den) cs CROSS JOIN chair c WHERE c.is_active),
      dem AS (SELECT kh.name AS chair, kh.slot_time,
                     count(*) FILTER (WHERE a.id IS NULL) AS idle,
                     count(*) FILTER (WHERE a.status = 'no_show') AS no_show
              FROM kh LEFT JOIN appointment a
                ON a.chair_id = kh.chair_id AND a.appt_date = kh.slot_date AND a.slot_time = kh.slot_time
               AND a.status <> 'cancelled'
              GROUP BY kh.name, kh.slot_time)
      SELECT chair, sum(idle) OVER (PARTITION BY chair) AS chair_idle, slot_time, idle, no_show
      FROM dem ORDER BY chair_idle DESC, chair, idle DESC, slot_time`,
  },
  'lapsed-patients': {
    title: 'Q3 — Bệnh nhân quá 6 tháng chưa quay lại (không có lịch sắp tới)',
    columns: [['full_name', 'Bệnh nhân'], ['contact_phone', 'SĐT'], ['last_visit', 'Lần khám cuối', 'date'],
      ['days', 'Số ngày', 'number']],
    link: { key: 'id', href: '/patients/' },
    sql: `
      SELECT p.id, p.full_name, p.contact_phone, max(a.appt_date) AS last_visit,
             local_date(now()) - max(a.appt_date) AS days
      FROM patient p
      JOIN appointment a ON a.patient_id = p.id
      JOIN treatment_record r ON r.appointment_id = a.id
      WHERE p.is_active
      GROUP BY p.id
      HAVING max(a.appt_date) < local_date(now()) - interval '6 months'
         AND NOT EXISTS (SELECT 1 FROM appointment f WHERE f.patient_id = p.id
                         AND f.appt_date >= local_date(now()) AND f.status = 'booked')
      ORDER BY last_visit`,
  },
  cancellations: {
    title: 'Q4 — Việc hay bị hủy lịch và lý do (hủy trong tháng)',
    columns: [['service', 'Việc dự kiến'], ['service_total', 'Tổng lần hủy của việc', 'number'],
      ['reason', 'Lý do'], ['times', 'Số lần', 'number', true]],
    sql: `
      SELECT sv.name AS service, sum(count(*)) OVER (PARTITION BY sv.id) AS service_total,
             cr.name AS reason, count(*) AS times
      FROM appointment a
      JOIN service sv ON sv.id = a.planned_service_id
      JOIN cancel_reason cr ON cr.id = a.cancel_reason_id
      WHERE a.status = 'cancelled' AND local_date(a.cancelled_at) >= $1 AND local_date(a.cancelled_at) < $2
      GROUP BY sv.id, sv.name, cr.name
      ORDER BY service_total DESC, service, times DESC`,
  },
  debts: {
    title: 'Q5 — Công nợ theo bệnh nhân (hiện tại)',
    columns: [['full_name', 'Bệnh nhân'], ['contact_phone', 'SĐT'], ['invoices', 'Số hóa đơn nợ', 'number'],
      ['since', 'Nợ từ ngày', 'date'], ['remaining', 'Còn nợ', 'money', true]],
    link: { key: 'patient_id', href: '/patients/' },
    sql: `
      SELECT p.id AS patient_id, p.full_name, p.contact_phone, count(*) AS invoices,
             min(local_date(b.created_at)) AS since, sum(b.remaining) AS remaining
      FROM invoice_balance b JOIN patient p ON p.id = b.patient_id
      WHERE b.remaining > 0
      GROUP BY p.id ORDER BY remaining DESC`,
  },
  plans: {
    title: 'Q6 — Liệu trình đang dở, còn mấy buổi',
    columns: [['patient', 'Bệnh nhân'], ['service', 'Liệu trình'], ['doctor', 'BS phụ trách'],
      ['sessions_done', 'Đã làm', 'number'], ['sessions_left', 'Còn lại', 'number'],
      ['paid', 'Đã thu', 'money'], ['total_price', 'Tổng giá', 'money']],
    link: { key: 'plan_id', href: '/plans/' },
    sql: `
      SELECT pp.plan_id, p.full_name AS patient, sv.name AS service, s.full_name AS doctor,
             pp.sessions_done, pp.sessions_left, pp.paid, pp.total_price
      FROM plan_progress pp
      JOIN patient p ON p.id = pp.patient_id
      JOIN service sv ON sv.id = pp.service_id
      JOIN staff s ON s.id = pp.doctor_id
      WHERE pp.status = 'active'
      ORDER BY pp.sessions_left, patient`,
  },
  'low-stock': {
    title: 'Q7 — Thuốc / vật tư sắp hết (tồn ≤ ngưỡng)',
    columns: [['kind_label', 'Loại'], ['name', 'Tên'], ['on_hand', 'Tồn', 'number'],
      ['reorder_threshold', 'Ngưỡng', 'number'], ['unit', 'Đơn vị']],
    sql: `
      SELECT CASE kind WHEN 'medicine' THEN 'Thuốc' ELSE 'Vật tư' END AS kind_label,
             name, on_hand, reorder_threshold, unit
      FROM inventory_stock
      WHERE below_threshold
      ORDER BY on_hand - reorder_threshold, name`,
  },
  'revenue-compare': {
    title: 'Q8 — Doanh thu 6 tháng gần nhất và % tăng giảm so với tháng trước (gồm cả thuốc)',
    columns: [['month', 'Tháng'], ['revenue', 'Doanh thu', 'money'], ['change_pct', 'So với tháng trước', 'pct']],
    chart: { label: 'month', value: 'revenue' },
    sql: `
      WITH m AS (SELECT generate_series(($1::date - interval '5 months')::date, $1::date, interval '1 month')::date AS month),
      dt AS (SELECT date_trunc('month', local_date(i.created_at))::date AS month, sum(l.amount) AS revenue
             FROM invoice i JOIN invoice_line l ON l.invoice_id = i.id
             GROUP BY 1),
      s AS (SELECT m.month, COALESCE(dt.revenue, 0) AS revenue FROM m LEFT JOIN dt ON dt.month = m.month)
      SELECT to_char(month, 'MM/YYYY') AS month, revenue,
             round((revenue - lag(revenue) OVER w) * 100.0 / NULLIF(lag(revenue) OVER w, 0), 1) AS change_pct
      FROM s WINDOW w AS (ORDER BY month) ORDER BY s.month`,
  },
  'cash-closings': {
    title: 'Đối soát két các ngày trong tháng (UC79)',
    columns: [['closing_date', 'Ngày', 'date'], ['expected_cash', 'Tiền mặt theo sổ', 'money', true],
      ['counted_cash', 'Đếm được', 'money', true], ['difference', 'Chênh lệch', 'money', true],
      ['note', 'Ghi chú'], ['closed_by', 'Người chốt']],
    sql: `
      SELECT cc.closing_date, cc.expected_cash, cc.counted_cash, cc.difference, cc.note, s.full_name AS closed_by
      FROM cash_closing cc JOIN staff s ON s.id = cc.closed_by
      WHERE cc.closing_date >= $1 AND cc.closing_date < $2 ORDER BY cc.closing_date`,
  },
};

const SHORT_TITLES = {
  'revenue-by-doctor': 'Q1 Doanh thu bác sĩ', 'chair-idle': 'Q2 Ghế trống', 'lapsed-patients': 'Q3 Lâu chưa quay lại',
  cancellations: 'Q4 Hủy lịch', debts: 'Q5 Công nợ', plans: 'Q6 Liệu trình dở', 'low-stock': 'Q7 Sắp hết',
  'revenue-compare': 'Q8 So tháng trước', 'cash-closings': 'Đối soát két',
};

reportsRouter.get('/reports', requireRole(MANAGER), (req, res) => {
  res.json(Object.entries(REPORTS).map(([key, r]) => ({ key, title: r.title, short: SHORT_TITLES[key] })));
});

reportsRouter.get('/reports/:key', requireRole(MANAGER), async (req, res) => {
  const report = REPORTS[req.params.key];
  if (!report) throw new HttpError(404, 'Không có báo cáo này');
  const m = month(req.query.month);
  const from = `${m}-01`;
  const [y, mm] = m.split('-').map(Number);
  const to = mm === 12 ? `${y + 1}-01-01` : `${y}-${String(mm + 1).padStart(2, '0')}-01`;
  // Chỉ truyền tham số câu SQL có dùng (báo cáo "hiện tại" không phụ thuộc tháng)
  const params = report.sql.includes('$2') ? [from, to] : report.sql.includes('$1') ? [from] : [];
  const rows = await query(report.sql, params);
  res.json({
    key: req.params.key,
    title: report.title,
    month: m,
    columns: report.columns.map(([key, label, type = 'text', sum = false]) => ({ key, label, type, sum })),
    chart: report.chart ?? null,
    heatmap: report.heatmap ?? null,
    link: report.link ?? null,
    rows,
  });
});

// Trang tổng quan theo vai trò
reportsRouter.get('/dashboard', requireRole(...ALL_ROLES), async (req, res) => {
  const today = todayLocal();
  const tomorrow = addDays(today, 1);
  const mine = req.user.role === DENTIST ? req.user.id : null;
  const [byStatus, counters, lowStock, upcoming] = await Promise.all([
    query(`SELECT status, count(*) AS n FROM appointment
           WHERE appt_date = $1 AND ($2::bigint IS NULL OR doctor_id = $2) GROUP BY status`, [today, mine]),
    queryOne(`
      SELECT
        (SELECT count(*) FROM appointment a WHERE a.appt_date = $1 AND a.status = 'checked_in'
           AND ($3::bigint IS NULL OR a.doctor_id = $3)
           AND NOT EXISTS (SELECT 1 FROM treatment_record r WHERE r.appointment_id = a.id)) AS waiting,
        (SELECT count(*) FROM treatment_record r
          WHERE NOT EXISTS (SELECT 1 FROM invoice i WHERE i.record_id = r.id)
            AND (EXISTS (SELECT 1 FROM treatment_line tl WHERE tl.record_id = r.id AND tl.plan_id IS NULL)
              OR EXISTS (SELECT 1 FROM prescription_item pi WHERE pi.record_id = r.id AND pi.dispensed_in_clinic))) AS pending_billing,
        (SELECT COALESCE(sum(remaining), 0) FROM invoice_balance WHERE remaining > 0) AS total_debt,
        (SELECT count(*) FROM appointment a WHERE a.appt_date = $2 AND a.status = 'booked'
           AND NOT EXISTS (SELECT 1 FROM appointment_reminder ar WHERE ar.appointment_id = a.id)) AS reminders_pending,
        (SELECT COALESCE(sum(l.amount), 0) FROM invoice_line l JOIN invoice i ON i.id = l.invoice_id
          WHERE date_trunc('month', local_date(i.created_at)) = date_trunc('month', $1::date)) AS month_revenue,
        (SELECT EXISTS (SELECT 1 FROM cash_closing WHERE closing_date = $1)) AS cash_closed`, [today, tomorrow, mine]),
    query('SELECT name, on_hand, reorder_threshold, unit FROM inventory_stock WHERE below_threshold ORDER BY name'),
    query(`
      SELECT a.id, a.slot_time, a.status, p.id AS patient_id, p.full_name AS patient_name, d.full_name AS doctor_name,
             c.name AS chair_name, sv.name AS service_name
      FROM appointment a
      JOIN patient p ON p.id = a.patient_id
      JOIN staff d ON d.id = a.doctor_id
      JOIN chair c ON c.id = a.chair_id
      JOIN service sv ON sv.id = a.planned_service_id
      WHERE a.appt_date = $1 AND a.status <> 'cancelled' AND ($2::bigint IS NULL OR a.doctor_id = $2)
      ORDER BY a.slot_time, c.id`, [today, mine]),
  ]);
  res.json({
    today,
    byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.n])),
    ...counters,
    lowStock,
    upcoming,
  });
});
