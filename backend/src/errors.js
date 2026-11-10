export class HttpError extends Error {
  // extra: { retryAfter } cho 429 (header Retry-After, giây)
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

// Tên ràng buộc trong schema.sql → thông báo cho người dùng
const CONSTRAINT_MESSAGES = {
  appointment_doctor_slot_uq: 'Bác sĩ đã có lịch ở khung giờ này',
  appointment_chair_slot_uq: 'Ghế đã có lịch ở khung giờ này',
  appointment_check: 'Khung giờ không hợp lệ (phút 00 hoặc 30, trong giờ mở cửa)',
  treatment_line_tooth_code_check: 'Số răng không hợp lệ (FDI 11–48, 51–85; 00 cả miệng, 01 hàm trên, 02 hàm dưới)',
  patient_contact_phone_check: 'Số điện thoại phải gồm 10–11 chữ số, bắt đầu bằng 0',
  staff_username_key: 'Tên đăng nhập đã tồn tại',
  role_permission_permission_code_fkey: 'Mã quyền không tồn tại',
  role_permission_pkey: 'Vai trò đã có quyền này',
  service_code_key: 'Mã dịch vụ đã tồn tại',
  service_price_pkey: 'Dịch vụ đã có giá cho ngày hiệu lực này',
  cash_closing_pkey: 'Ngày này đã chốt két',
  cash_closing_check: 'Tiền đếm được lệch với sổ — phải ghi lý do',
  chair_name_key: 'Tên ghế đã tồn tại',
  cancel_reason_name_key: 'Lý do hủy đã tồn tại',
  inventory_item_kind_name_key: 'Tên thuốc / vật tư đã tồn tại',
  doctor_shift_doctor_id_doctor_role_fkey: 'Chỉ xếp ca cho nhân viên là bác sĩ',
  treatment_plan_service_id_service_kind_fkey: 'Liệu trình phải dùng dịch vụ loại liệu trình',
  invoice_record_id_key: 'Phiếu này đã có hóa đơn',
  invoice_installment_id_key: 'Đợt này đã có hóa đơn',
};

const CODE_MESSAGES = {
  23505: 'Dữ liệu bị trùng',
  23503: 'Dữ liệu tham chiếu không tồn tại hoặc đang được dùng ở nơi khác',
  23514: 'Dữ liệu vi phạm ràng buộc',
  23502: 'Thiếu dữ liệu bắt buộc',
  '22P02': 'Giá trị không hợp lệ',
  22007: 'Ngày giờ không hợp lệ',
  22008: 'Ngày giờ không hợp lệ',
};

// Lỗi Prisma bọc lỗi Postgres gốc trong meta.driverAdapterError.cause → đưa về dạng lỗi của pg
// (code SQLSTATE, tên ràng buộc, thông báo trigger) để xử lý chung một chỗ bên dưới.
function fromPrisma(err) {
  if (err?.name !== 'PrismaClientKnownRequestError') return err;
  if (err.code === 'P2025') return new HttpError(404, 'Không tìm thấy dữ liệu');
  const cause = err.meta?.driverAdapterError?.cause;
  if (!cause?.originalCode) return err;
  return { code: cause.originalCode, constraint: cause.constraint?.index, message: cause.originalMessage };
}

export function errorHandler(rawErr, req, res, next) {
  const err = fromPrisma(rawErr);
  if (err instanceof HttpError) {
    if (err.status === 429 && err.retryAfter) res.set('Retry-After', String(err.retryAfter));
    return res.status(err.status).json({ error: err.message });
  }
  if (err.code === 'P0001') {
    // RAISE EXCEPTION trong trigger: thông báo đã viết sẵn tiếng Việt
    return res.status(409).json({ error: err.message });
  }
  if (CODE_MESSAGES[err.code]) {
    const message = CONSTRAINT_MESSAGES[err.constraint]
      ?? (err.code === '23502' && err.column ? `Thiếu ${err.column}` : CODE_MESSAGES[err.code]);
    return res.status(err.code === '23505' ? 409 : 400).json({ error: message });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Dữ liệu gửi lên không phải JSON hợp lệ' });
  }
  console.error(rawErr);
  res.status(500).json({ error: 'Lỗi máy chủ' });
}
