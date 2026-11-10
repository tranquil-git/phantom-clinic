// UC40/UC60 bảng giá, UC61 ca trực, UC62 danh mục, UC63 tài khoản, UC50/UC51 kho
import { Router } from 'express';
import { ALL_ROLES, DENTIST, MANAGER, hashPassword, requireRole } from '../auth.js';
import { query, queryOne, tx } from '../db.js';
import { HttpError } from '../errors.js';
import { date, id, money, oneOf, optText, quantity, text, time, todayLocal } from '../validate.js';

export const adminRouter = Router();

// Danh mục nhỏ dùng cho các ô chọn ở mọi màn hình
adminRouter.get('/lookups', requireRole(...ALL_ROLES), async (req, res) => {
  const [chairs, doctors, services, cancelReasons, medicines] = await Promise.all([
    query('SELECT id, name FROM chair WHERE is_active ORDER BY id'),
    query("SELECT id, full_name FROM staff WHERE role = 'dentist' AND is_active ORDER BY full_name"),
    query(`SELECT id, code, name, kind, service_price_at(id, local_date(now())) AS price
           FROM service WHERE is_active ORDER BY kind, name`),
    query('SELECT id, name FROM cancel_reason WHERE is_active ORDER BY id'),
    query(`SELECT id, name, unit, sale_price FROM inventory_item
           WHERE kind = 'medicine' AND is_active ORDER BY name`),
  ]);
  res.json({ chairs, doctors, services, cancelReasons, medicines });
});

// ---------------------------------------------------------------------
// Bảng giá
// ---------------------------------------------------------------------
adminRouter.get('/prices', requireRole(...ALL_ROLES), async (req, res) => {
  res.json(await query(`
    SELECT sv.id, sv.code, sv.name, sv.kind, sv.is_active,
           service_price_at(sv.id, local_date(now())) AS current_price,
           COALESCE(json_agg(json_build_object('effective_from', sp.effective_from, 'price', sp.price)
                    ORDER BY sp.effective_from DESC) FILTER (WHERE sp.service_id IS NOT NULL), '[]') AS history
    FROM service sv LEFT JOIN service_price sp ON sp.service_id = sv.id
    GROUP BY sv.id ORDER BY sv.kind, sv.name`));
});

adminRouter.post('/prices', requireRole(MANAGER), async (req, res) => {
  const b = req.body ?? {};
  const row = await queryOne(`
    INSERT INTO service_price (service_id, effective_from, price, created_by)
    VALUES ($1, $2, $3, $4) RETURNING *`,
  [id(b.service_id, 'Dịch vụ'), date(b.effective_from, 'Ngày hiệu lực'), money(b.price, 'Giá'), req.user.id]);
  res.status(201).json(row);
});

// ---------------------------------------------------------------------
// Ca trực (LN-11)
// ---------------------------------------------------------------------
adminRouter.get('/shifts', requireRole(MANAGER, DENTIST), async (req, res) => {
  const from = date(req.query.from ?? todayLocal(), 'Từ ngày');
  const to = date(req.query.to ?? from, 'Đến ngày');
  res.json(await query(`
    SELECT sh.id, sh.doctor_id, s.full_name AS doctor_name, sh.shift_date, sh.start_time, sh.end_time,
           (SELECT count(*) FROM appointment a WHERE a.doctor_id = sh.doctor_id AND a.appt_date = sh.shift_date
              AND a.status <> 'cancelled') AS appointment_count
    FROM doctor_shift sh JOIN staff s ON s.id = sh.doctor_id
    WHERE sh.shift_date BETWEEN $1 AND $2
    ORDER BY sh.shift_date, s.full_name`, [from, to]));
});

// Xếp ca cho một khoảng ngày theo các thứ trong tuần (1 = T2 … 7 = CN); có ca thì cập nhật giờ
adminRouter.post('/shifts', requireRole(MANAGER), async (req, res) => {
  const b = req.body ?? {};
  const doctorId = id(b.doctor_id, 'Bác sĩ');
  const from = date(b.from, 'Từ ngày');
  const to = date(b.to ?? b.from, 'Đến ngày');
  const start = time(b.start_time, 'Giờ bắt đầu');
  const end = time(b.end_time, 'Giờ kết thúc');
  const weekdays = Array.isArray(b.weekdays) && b.weekdays.length ? b.weekdays.map(Number) : [1, 2, 3, 4, 5, 6, 7];
  if (to < from) throw new HttpError(400, 'Đến ngày phải sau từ ngày');
  if (start >= end) throw new HttpError(400, 'Giờ kết thúc phải sau giờ bắt đầu');

  const rows = await tx(req.user.id, async (client) => {
    // GT-22: không rút ca làm lịch đã đặt nằm ngoài ca
    const { rows: outside } = await client.query(`
      SELECT a.appt_date, a.slot_time FROM appointment a
      WHERE a.doctor_id = $1 AND a.appt_date BETWEEN $2 AND $3 AND a.status <> 'cancelled'
        AND extract(isodow FROM a.appt_date)::int = ANY($6::int[])
        AND (a.slot_time < $4::time OR a.slot_time + interval '30 minutes' > $5::time)
      LIMIT 1`, [doctorId, from, to, start, end, weekdays]);
    if (outside[0]) {
      throw new HttpError(409, `Có lịch hẹn ngày ${outside[0].appt_date} lúc ${outside[0].slot_time} nằm ngoài ca mới`);
    }
    const result = await client.query(`
      INSERT INTO doctor_shift (doctor_id, shift_date, start_time, end_time, created_by)
      SELECT $1, d::date, $4, $5, $6
      FROM generate_series($2::date, $3::date, interval '1 day') d
      WHERE extract(isodow FROM d)::int = ANY($7::int[])
      ON CONFLICT (doctor_id, shift_date) DO UPDATE SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time
      RETURNING id`, [doctorId, from, to, start, end, req.user.id, weekdays]);
    return result.rowCount;
  });
  res.status(201).json({ count: rows });
});

adminRouter.delete('/shifts/:id', requireRole(MANAGER), async (req, res) => {
  await tx(req.user.id, async (client) => {
    const { rows: [sh] } = await client.query('SELECT * FROM doctor_shift WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!sh) throw new HttpError(404, 'Không tìm thấy ca trực');
    const { rows: [busy] } = await client.query(`
      SELECT count(*) AS n FROM appointment
      WHERE doctor_id = $1 AND appt_date = $2 AND status <> 'cancelled'`, [sh.doctor_id, sh.shift_date]);
    if (busy.n > 0) throw new HttpError(409, `Bác sĩ còn ${busy.n} lịch hẹn trong ca này — đổi hoặc hủy lịch trước`);
    await client.query('DELETE FROM doctor_shift WHERE id = $1', [sh.id]);
  });
  res.status(204).end();
});

// ---------------------------------------------------------------------
// Danh mục (UC62)
// ---------------------------------------------------------------------
adminRouter.get('/catalog', requireRole(MANAGER), async (req, res) => {
  const [services, chairs, cancelReasons, items, supplies] = await Promise.all([
    query('SELECT * FROM service ORDER BY kind, name'),
    query('SELECT * FROM chair ORDER BY id'),
    query('SELECT * FROM cancel_reason ORDER BY id'),
    query('SELECT * FROM inventory_item ORDER BY kind, name'),
    query(`SELECT ss.service_id, sv.name AS service_name, ss.item_id, it.name AS item_name, it.unit, ss.quantity
           FROM service_supply ss JOIN service sv ON sv.id = ss.service_id JOIN inventory_item it ON it.id = ss.item_id
           ORDER BY sv.name, it.name`),
  ]);
  res.json({ services, chairs, cancelReasons, items, supplies });
});

adminRouter.post('/catalog/services', requireRole(MANAGER), async (req, res) => {
  const b = req.body ?? {};
  res.status(201).json(await queryOne(
    'INSERT INTO service (code, name, kind) VALUES ($1, $2, $3) RETURNING *',
    [text(b.code, 'mã dịch vụ').toUpperCase(), text(b.name, 'tên dịch vụ'), oneOf(b.kind ?? 'single', ['single', 'plan'], 'Loại')]));
});

adminRouter.patch('/catalog/services/:id', requireRole(MANAGER), async (req, res) => {
  const b = req.body ?? {};
  const row = await queryOne('UPDATE service SET name = $1, is_active = $2 WHERE id = $3 RETURNING *',
    [text(b.name, 'tên dịch vụ'), b.is_active !== false, req.params.id]);
  if (!row) throw new HttpError(404, 'Không tìm thấy dịch vụ');
  res.json(row);
});

adminRouter.post('/catalog/chairs', requireRole(MANAGER), async (req, res) => {
  res.status(201).json(await queryOne('INSERT INTO chair (name) VALUES ($1) RETURNING *', [text(req.body?.name, 'tên ghế')]));
});

adminRouter.patch('/catalog/chairs/:id', requireRole(MANAGER), async (req, res) => {
  const row = await queryOne('UPDATE chair SET name = $1, is_active = $2 WHERE id = $3 RETURNING *',
    [text(req.body?.name, 'tên ghế'), req.body?.is_active !== false, req.params.id]);
  if (!row) throw new HttpError(404, 'Không tìm thấy ghế');
  res.json(row);
});

adminRouter.post('/catalog/cancel-reasons', requireRole(MANAGER), async (req, res) => {
  res.status(201).json(await queryOne('INSERT INTO cancel_reason (name) VALUES ($1) RETURNING *', [text(req.body?.name, 'lý do')]));
});

adminRouter.patch('/catalog/cancel-reasons/:id', requireRole(MANAGER), async (req, res) => {
  const row = await queryOne('UPDATE cancel_reason SET name = $1, is_active = $2 WHERE id = $3 RETURNING *',
    [text(req.body?.name, 'lý do'), req.body?.is_active !== false, req.params.id]);
  if (!row) throw new HttpError(404, 'Không tìm thấy lý do hủy');
  res.json(row);
});

function itemInput(b) {
  const kind = oneOf(b.kind, ['medicine', 'supply'], 'Loại');
  const threshold = Number(b.reorder_threshold ?? 0);
  if (!Number.isFinite(threshold) || threshold < 0) throw new HttpError(400, 'Ngưỡng tồn không hợp lệ');
  const salePrice = kind === 'medicine' && b.sale_price !== '' && b.sale_price != null ? money(b.sale_price, 'Giá bán') : null;
  return [kind, text(b.name, 'tên'), text(b.unit, 'đơn vị'), threshold, salePrice];
}

adminRouter.post('/catalog/items', requireRole(MANAGER), async (req, res) => {
  res.status(201).json(await queryOne(`
    INSERT INTO inventory_item (kind, name, unit, reorder_threshold, sale_price) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
  itemInput(req.body ?? {})));
});

adminRouter.patch('/catalog/items/:id', requireRole(MANAGER), async (req, res) => {
  const row = await queryOne(`
    UPDATE inventory_item SET kind = $1, name = $2, unit = $3, reorder_threshold = $4, sale_price = $5, is_active = $6
    WHERE id = $7 RETURNING *`, [...itemInput(req.body ?? {}), req.body?.is_active !== false, req.params.id]);
  if (!row) throw new HttpError(404, 'Không tìm thấy thuốc / vật tư');
  res.json(row);
});

adminRouter.put('/catalog/supplies', requireRole(MANAGER), async (req, res) => {
  const b = req.body ?? {};
  res.json(await queryOne(`
    INSERT INTO service_supply (service_id, item_id, quantity) VALUES ($1, $2, $3)
    ON CONFLICT (service_id, item_id) DO UPDATE SET quantity = EXCLUDED.quantity RETURNING *`,
  [id(b.service_id, 'Dịch vụ'), id(b.item_id, 'Vật tư'), quantity(b.quantity, 'Định mức')]));
});

adminRouter.delete('/catalog/supplies', requireRole(MANAGER), async (req, res) => {
  await query('DELETE FROM service_supply WHERE service_id = $1 AND item_id = $2',
    [id(req.query.service_id, 'Dịch vụ'), id(req.query.item_id, 'Vật tư')]);
  res.status(204).end();
});

// ---------------------------------------------------------------------
// Tài khoản nhân viên (UC63)
// ---------------------------------------------------------------------
const ROLES = ['receptionist', 'dentist', 'manager'];

adminRouter.get('/staff', requireRole(MANAGER), async (req, res) => {
  res.json(await query('SELECT id, full_name, phone, role, username, is_active, created_at FROM staff ORDER BY role, full_name'));
});

adminRouter.post('/staff', requireRole(MANAGER), async (req, res) => {
  const b = req.body ?? {};
  const password = text(b.password, 'mật khẩu');
  if (password.length < 6) throw new HttpError(400, 'Mật khẩu tối thiểu 6 ký tự');
  res.status(201).json(await queryOne(`
    INSERT INTO staff (full_name, phone, role, username, password_hash) VALUES ($1, $2, $3, $4, $5)
    RETURNING id, full_name, role, username`,
  [text(b.full_name, 'họ tên'), optText(b.phone), oneOf(b.role, ROLES, 'Vai trò'),
    text(b.username, 'tên đăng nhập').toLowerCase(), hashPassword(password)]));
});

adminRouter.patch('/staff/:id', requireRole(MANAGER), async (req, res) => {
  const b = req.body ?? {};
  const isActive = b.is_active !== false;
  if (Number(req.params.id) === req.user.id && (!isActive || b.role !== MANAGER)) {
    throw new HttpError(409, 'Không tự khóa hoặc tự đổi vai trò của chính mình');
  }
  const password = optText(b.password);
  if (password && password.length < 6) throw new HttpError(400, 'Mật khẩu tối thiểu 6 ký tự');
  const row = await queryOne(`
    UPDATE staff SET full_name = $1, phone = $2, role = $3, is_active = $4,
           password_hash = COALESCE($5, password_hash)
    WHERE id = $6 RETURNING id, full_name, role, username, is_active`,
  [text(b.full_name, 'họ tên'), optText(b.phone), oneOf(b.role, ROLES, 'Vai trò'), isActive,
    password ? hashPassword(password) : null, req.params.id]);
  if (!row) throw new HttpError(404, 'Không tìm thấy nhân viên');
  res.json(row);
});

// ---------------------------------------------------------------------
// Kho (UC50, UC51)
// ---------------------------------------------------------------------
adminRouter.get('/inventory', requireRole(MANAGER), async (req, res) => {
  const [stock, movements] = await Promise.all([
    query('SELECT * FROM inventory_stock ORDER BY below_threshold DESC, kind, name'),
    query(`
      SELECT m.id, m.movement_type, m.quantity, m.note, m.created_at, m.record_id,
             it.name AS item_name, it.unit, s.full_name AS created_by_name
      FROM stock_movement m JOIN inventory_item it ON it.id = m.item_id JOIN staff s ON s.id = m.created_by
      ORDER BY m.created_at DESC, m.id DESC LIMIT 100`),
  ]);
  res.json({ stock, movements });
});

adminRouter.post('/inventory/movements', requireRole(MANAGER), async (req, res) => {
  const b = req.body ?? {};
  const type = oneOf(b.movement_type, ['receipt', 'manual_out', 'adjustment'], 'Loại phiếu');
  const qty = Number(b.quantity);
  if (!Number.isFinite(qty) || qty === 0) throw new HttpError(400, 'Số lượng không hợp lệ');
  // Nhập luôn dương, xuất thủ công luôn âm, điều chỉnh kiểm kê giữ dấu người dùng nhập
  const signed = type === 'receipt' ? Math.abs(qty) : type === 'manual_out' ? -Math.abs(qty) : qty;
  if (type !== 'receipt' && !optText(b.note)) throw new HttpError(400, 'Ghi lý do xuất / điều chỉnh');
  const row = await tx(req.user.id, async (client) => {
    const { rows } = await client.query(`
      INSERT INTO stock_movement (item_id, movement_type, quantity, note, created_by)
      VALUES ($1, $2, $3, $4, $5) RETURNING *`, [id(b.item_id, 'Thuốc / vật tư'), type, signed, optText(b.note), req.user.id]);
    return rows[0];
  });
  res.status(201).json(row);
});
