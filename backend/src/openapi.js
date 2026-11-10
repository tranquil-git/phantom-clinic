// Tài liệu OpenAPI 3.1 (Swagger) sinh từ chính các route Express:
//   - method + đường dẫn + mã quyền: đọc từ router (authorize() gắn .permission vào middleware)
//   - vai trò đang có quyền: đọc từ bảng role_permission qua Prisma lúc mở tài liệu (luôn khớp thực tế)
//   - tóm tắt, tham số, body: ROUTE_DOCS bên dưới (test/openapi.test.js bắt lỗi nếu route nào thiếu)
// Xem: GET /api/docs (Swagger UI), GET /api/openapi.json (file spec).
import { LOGIN_LIMIT, TOKEN_TTL_SECONDS } from './auth.js';
import { prisma } from './prisma.js';
import { REPORT_KEYS } from './routes/reports.js';

// ---------------------------------------------------------------------
// Ký hiệu gọn cho schema
// ---------------------------------------------------------------------
const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const int = (description, extra = {}) => ({ type: 'integer', description, ...extra });
const num = (description, extra = {}) => ({ type: 'number', description, ...extra });
const bool = (description, extra = {}) => ({ type: 'boolean', description, ...extra });
const day = (description) => str(description, { format: 'date', example: '2026-11-12' });
const hhmm = (description) => str(description, { pattern: '^\\d{2}:\\d{2}$', example: '09:30' });
const money = (description) => int(`${description} (VNĐ)`, { minimum: 0 });
const oneOf = (description, values) => str(description, { enum: values });
const arr = (items, description) => ({ type: 'array', items, ...(description && { description }) });
const obj = (properties, required = [], extra = {}) => ({ type: 'object', properties, required, ...extra });
const q = (name, schema, required = false) => ({ name, in: 'query', required, schema, description: schema.description });

const ID_PARAM_NAMES = { id: 'Mã (id)', recordId: 'Mã phiếu điều trị', role: 'Vai trò', key: 'Mã báo cáo' };

// ---------------------------------------------------------------------
// Mô tả từng endpoint. Khóa: "METHOD <đường dẫn Express>"
// ---------------------------------------------------------------------
const PATIENT_BODY = obj({
  full_name: str('Họ tên', { example: 'Lê Văn Khoa' }),
  contact_phone: str('SĐT liên hệ, 10–11 số bắt đầu bằng 0 (trẻ em: SĐT người giám hộ)', { example: '0912345678' }),
  date_of_birth: day('Ngày sinh'),
  gender: oneOf('Giới tính', ['male', 'female', 'other']),
  guardian_name: str('Người giám hộ (bắt buộc nếu dưới 15 tuổi)'),
  guardian_relation: str('Quan hệ với người giám hộ'),
  paper_record_no: str('Số hồ sơ giấy cũ'),
  address: str('Địa chỉ'),
  medical_note: str('Tiền sử, dị ứng'),
}, ['full_name', 'contact_phone']);

const LOGIN_BODY = obj({
  username: str('Tên đăng nhập (không phân biệt hoa thường)', { example: 'hung' }),
  password: str('Mật khẩu', { format: 'password' }),
}, ['username', 'password']);

const ROUTE_DOCS = {
  // Xác thực ---------------------------------------------------------
  'POST /api/auth/login': {
    public: true, summary: 'Đăng nhập (website): đặt cookie phiên httpOnly',
    description: `Đúng thì đặt cookie \`clinic_token\` (httpOnly, SameSite=Lax, Secure khi production) hạn ${TOKEN_TTL_SECONDS / 3600} giờ.
Sai quá ${LOGIN_LIMIT.perAccountAndIp} lần / ${LOGIN_LIMIT.windowMinutes} phút cho một tài khoản từ một IP → **429** kèm header \`Retry-After\`.`,
    body: LOGIN_BODY, response: { $ref: '#/components/schemas/User' }, errors: [400, 401, 429],
  },
  'POST /api/auth/token': {
    public: true, summary: 'Lấy access token (Swagger, Postman, app khác)',
    description: 'Giống đăng nhập nhưng trả JWT trong body, không đặt cookie. Gửi lại bằng header `Authorization: Bearer <access_token>` (nút **Authorize** ở đầu trang).',
    body: LOGIN_BODY, response: { $ref: '#/components/schemas/TokenResponse' }, errors: [400, 401, 429],
  },
  'POST /api/auth/logout': { public: true, summary: 'Đăng xuất: xóa cookie phiên', status: 204 },
  'GET /api/auth/me': {
    summary: 'Người đang đăng nhập + danh sách mã quyền',
    description: 'Website dùng danh sách `permissions` để hiện / ẩn menu.',
    response: { $ref: '#/components/schemas/User' },
  },
  'POST /api/auth/change-password': {
    summary: 'Đổi mật khẩu của chính mình',
    description: `Mật khẩu mới: 8–128 ký tự, có chữ và số, không chứa tên đăng nhập.
Sau khi đổi, **mọi token / phiên cũ** của tài khoản bị từ chối (401). Gọi bằng cookie → nhận cookie mới; gọi bằng Bearer → nhận \`access_token\` mới trong body.`,
    body: obj({ current_password: str('Mật khẩu hiện tại', { format: 'password' }), new_password: str('Mật khẩu mới', { format: 'password' }) },
      ['current_password', 'new_password']),
  },

  // Phân quyền -------------------------------------------------------
  'GET /api/roles': { summary: 'Danh sách vai trò, số nhân viên, mã quyền đang có', response: arr({ $ref: '#/components/schemas/Role' }) },
  'GET /api/permissions': { summary: 'Danh mục mã quyền và vai trò đang có quyền', response: arr({ $ref: '#/components/schemas/Permission' }) },
  'PUT /api/roles/:role/permissions': {
    summary: 'Đặt lại toàn bộ quyền của một vai trò',
    description: 'Gửi **đủ** danh sách mã quyền mong muốn: mã không có trong danh sách bị thu hồi, mã mới được cấp. Có hiệu lực ngay ở request kế tiếp của nhân viên thuộc vai trò đó. Không thu hồi được `permission.read` / `permission.manage` của Quản lý (409).',
    params: { role: oneOf('Vai trò', ['receptionist', 'dentist', 'manager']) },
    body: obj({ permissions: arr(str('Mã quyền'), 'Danh sách mã quyền') }, ['permissions'],
      { example: { permissions: ['patient.read', 'appointment.read', 'report.read'] } }),
    response: { $ref: '#/components/schemas/Role' },
  },
  'GET /api/login-attempts': {
    summary: 'Nhật ký đăng nhập (mới nhất trước)',
    query: [q('username', str('Lọc theo tên đăng nhập')), q('success', oneOf('Lọc theo kết quả', ['true', 'false'])),
      q('limit', int('Số dòng, mặc định 50, tối đa 200', { minimum: 1, maximum: 200 }))],
    response: arr({ $ref: '#/components/schemas/LoginAttempt' }),
  },

  // Bệnh nhân --------------------------------------------------------
  'GET /api/patients': { summary: 'Tìm bệnh nhân theo đầu số điện thoại hoặc tên', query: [q('q', str('SĐT (đầu số) hoặc một phần họ tên'))] },
  'POST /api/patients': { summary: 'Thêm bệnh nhân', body: PATIENT_BODY, status: 201 },
  'PUT /api/patients/:id': { summary: 'Sửa thông tin bệnh nhân', body: PATIENT_BODY },
  'GET /api/patients/:id': { summary: 'Hồ sơ bệnh nhân: lịch hẹn, phiếu điều trị, liệu trình, hóa đơn, người cùng SĐT' },

  // Lịch hẹn ---------------------------------------------------------
  'GET /api/appointments': { summary: 'Lịch hẹn trong ngày', query: [q('date', day('Ngày, mặc định hôm nay')), q('doctor_id', int('Lọc theo bác sĩ'))] },
  'GET /api/appointments/slots': {
    summary: 'Khung giờ còn trống của bác sĩ trong ngày (kèm ghế trống)',
    query: [q('date', day('Ngày'), true), q('doctor_id', int('Bác sĩ'), true), q('except_id', int('Bỏ qua lịch này (khi dời lịch)'))],
  },
  'POST /api/appointments': {
    summary: 'Đặt lịch hẹn (hoặc tiếp nhận khách không hẹn)',
    description: '`walk_in = true` → đặt và check-in ngay, cần thêm quyền `appointment.walk_in`. Không gửi `chair_id` thì tự chọn ghế trống.',
    body: obj({
      patient_id: int('Bệnh nhân'), doctor_id: int('Bác sĩ'), planned_service_id: int('Việc dự kiến làm (dịch vụ)'),
      appt_date: day('Ngày hẹn'), slot_time: hhmm('Khung giờ (phút 00 hoặc 30)'), chair_id: int('Ghế'),
      note: str('Ghi chú'), walk_in: bool('Khách không hẹn, check-in luôn', { default: false }),
    }, ['patient_id', 'doctor_id', 'planned_service_id', 'appt_date', 'slot_time']),
    status: 201,
  },
  'POST /api/appointments/:id/reschedule': {
    summary: 'Dời lịch hẹn',
    body: obj({ doctor_id: int('Bác sĩ'), appt_date: day('Ngày mới'), slot_time: hhmm('Khung giờ mới'), note: str('Ghi chú') },
      ['doctor_id', 'appt_date', 'slot_time']),
  },
  'POST /api/appointments/:id/cancel': {
    summary: 'Hủy lịch hẹn (bắt buộc lý do)',
    body: obj({ cancel_reason_id: int('Lý do hủy (danh mục)'), cancel_note: str('Ghi chú thêm') }, ['cancel_reason_id']),
  },
  'POST /api/appointments/:id/check-in': { summary: 'Check-in khách đến (chỉ lịch hôm nay)', body: obj({ chair_id: int('Ghế, bỏ trống thì giữ ghế đã đặt') }) },
  'POST /api/appointments/:id/no-show': { summary: 'Đánh dấu khách không đến' },
  'GET /api/reminders': { summary: 'Danh sách cần gọi nhắc lịch', query: [q('date', day('Ngày hẹn cần nhắc, mặc định ngày mai'))] },
  'POST /api/reminders': {
    summary: 'Ghi kết quả gọi nhắc / gửi SMS',
    body: obj({
      appointment_id: int('Lịch hẹn'), channel: oneOf('Kênh', ['call', 'sms']),
      result: oneOf('Kết quả gọi (kênh call)', ['confirmed', 'wants_reschedule', 'wants_cancel', 'no_answer']), note: str('Ghi chú'),
    }, ['appointment_id', 'channel']),
    status: 201,
  },

  // Điều trị ---------------------------------------------------------
  'GET /api/queue': { summary: 'Hàng chờ khám (khách đã check-in)', query: [q('date', day('Ngày, mặc định hôm nay'))] },
  'POST /api/records': { summary: 'Mở phiếu điều trị cho lịch đã check-in (gọi lại trả phiếu cũ)', body: obj({ appointment_id: int('Lịch hẹn') }, ['appointment_id']) },
  'GET /api/records/:id': { summary: 'Phiếu điều trị: việc đã làm, đơn thuốc, liệu trình, hóa đơn, lịch sử sửa' },
  'PUT /api/records/:id': {
    summary: 'Sửa chẩn đoán / ghi chú (bác sĩ mở phiếu)',
    body: obj({ diagnosis: str('Chẩn đoán'), note: str('Ghi chú'), reason: str('Lý do sửa (bắt buộc khi phiếu đã có hóa đơn)') }),
  },
  'POST /api/records/:id/lines': {
    summary: 'Ghi một việc đã làm',
    body: obj({
      service_id: int('Dịch vụ'), tooth_code: str('Răng theo FDI (11–48, 51–85), 00 cả miệng, 01 hàm trên, 02 hàm dưới', { example: '26' }),
      plan_id: int('Thuộc liệu trình (nếu có)'), doctor_id: int('Bác sĩ thực hiện, mặc định người mở phiếu'), note: str('Ghi chú'),
    }, ['service_id', 'tooth_code']),
    status: 201,
  },
  'PUT /api/lines/:id': {
    summary: 'Sửa việc đã làm',
    body: obj({ service_id: int('Dịch vụ'), tooth_code: str('Răng (FDI)'), doctor_id: int('Bác sĩ thực hiện'), note: str('Ghi chú'), reason: str('Lý do sửa') },
      ['service_id', 'tooth_code', 'doctor_id']),
  },
  'DELETE /api/lines/:id': { summary: 'Xóa việc đã làm (khi chưa thu tiền)', body: obj({ reason: str('Lý do xóa') }) },
  'POST /api/records/:id/prescriptions': {
    summary: 'Kê thuốc',
    body: obj({ item_id: int('Thuốc'), dosage: str('Liều dùng', { example: '1 viên x 3 lần/ngày' }), quantity: num('Số lượng', { exclusiveMinimum: 0 }),
      dispensed_in_clinic: bool('Phát tại phòng khám (tính tiền, trừ kho)', { default: false }) }, ['item_id', 'dosage', 'quantity']),
    status: 201,
  },
  'DELETE /api/prescriptions/:id': { summary: 'Xóa thuốc đã kê', body: obj({ reason: str('Lý do xóa') }) },
  'GET /api/plans': { summary: 'Danh sách liệu trình', query: [q('status', oneOf('Trạng thái', ['active', 'completed', 'cancelled']))] },
  'GET /api/plans/:id': { summary: 'Chi tiết liệu trình: các đợt trả tiền, các buổi đã làm, lịch sử sửa' },
  'POST /api/plans': {
    summary: 'Lập liệu trình (niềng, implant…) với các đợt trả tiền',
    description: 'Tổng các đợt phải bằng `total_price`.',
    body: obj({
      patient_id: int('Bệnh nhân'), service_id: int('Dịch vụ loại liệu trình'), total_price: money('Tổng giá'),
      planned_sessions: int('Số buổi dự kiến', { minimum: 1 }), note: str('Ghi chú'),
      installments: arr(obj({ amount: money('Số tiền đợt'), due_date: day('Hạn trả') }, ['amount', 'due_date']), 'Các đợt trả tiền'),
    }, ['patient_id', 'service_id', 'total_price', 'planned_sessions', 'installments']),
    status: 201,
  },
  'PATCH /api/plans/:id': {
    summary: 'Cập nhật liệu trình (bác sĩ phụ trách)',
    body: obj({ status: oneOf('Trạng thái', ['active', 'completed', 'cancelled']), planned_sessions: int('Số buổi dự kiến'),
      note: str('Ghi chú'), reason: str('Lý do thay đổi') }, ['status', 'planned_sessions']),
  },

  // Thu ngân ---------------------------------------------------------
  'GET /api/billing/pending': { summary: 'Phiếu điều trị và đợt liệu trình chưa lập hóa đơn' },
  'GET /api/billing/preview/:recordId': { summary: 'Xem trước các dòng tính tiền của phiếu (giá theo ngày khám)' },
  'POST /api/invoices': {
    summary: 'Lập hóa đơn cho phiếu điều trị',
    description: 'Giảm giá theo dòng (`line_discounts`, khóa `t<id việc>` / `p<id thuốc>`) và / hoặc giảm ở tổng (`total_discount`, chia theo tỷ lệ các dòng). Có giảm giá thì bắt buộc `discount_reason`.',
    body: obj({
      record_id: int('Phiếu điều trị'), total_discount: money('Giảm ở tổng'),
      line_discounts: obj({}, [], { additionalProperties: int('Số tiền giảm'), description: 'Giảm theo dòng', example: { t12: 20000 } }),
      discount_reason: str('Lý do giảm giá'),
    }, ['record_id']),
    status: 201,
  },
  'POST /api/invoices/installment': { summary: 'Lập hóa đơn cho một đợt liệu trình', body: obj({ installment_id: int('Đợt liệu trình') }, ['installment_id']), status: 201 },
  'GET /api/invoices': {
    summary: 'Danh sách hóa đơn',
    query: [q('status', oneOf('Lọc', ['unpaid', 'paid', 'all'])), q('q', str('Tên hoặc SĐT bệnh nhân'))],
  },
  'GET /api/invoices/:id': { summary: 'Chi tiết hóa đơn: dòng tiền, các lần thu, còn nợ' },
  'POST /api/invoices/:id/payments': {
    summary: 'Thu tiền (cho phép thu một phần, không thu quá số còn nợ)',
    body: obj({ amount: money('Số tiền'), method: oneOf('Hình thức', ['cash', 'transfer']), note: str('Ghi chú') }, ['amount', 'method']),
    status: 201,
  },
  'GET /api/cash-closing': { summary: 'Chốt két trong ngày: tiền mặt theo sổ, đã chốt chưa', query: [q('date', day('Ngày, mặc định hôm nay'))] },
  'POST /api/cash-closing': {
    summary: 'Chốt két cuối ngày (lệch sổ thì bắt buộc ghi chú)',
    body: obj({ counted_cash: money('Tiền mặt đếm được'), note: str('Ghi chú / lý do lệch') }, ['counted_cash']),
    status: 201,
  },

  // Danh mục, giá, ca trực, nhân viên, kho ---------------------------
  'GET /api/lookups': { summary: 'Dữ liệu cho ô chọn: ghế, bác sĩ, dịch vụ (kèm giá hôm nay), lý do hủy, thuốc' },
  'GET /api/prices': { summary: 'Bảng giá dịch vụ: giá hiện hành và lịch sử' },
  'POST /api/prices': {
    summary: 'Đặt giá mới cho dịch vụ từ một ngày',
    body: obj({ service_id: int('Dịch vụ'), effective_from: day('Áp dụng từ ngày'), price: money('Giá') }, ['service_id', 'effective_from', 'price']),
    status: 201,
  },
  'GET /api/shifts': { summary: 'Ca trực bác sĩ trong khoảng ngày', query: [q('from', day('Từ ngày')), q('to', day('Đến ngày'))] },
  'POST /api/shifts': {
    summary: 'Xếp ca hàng loạt (ghi đè ca cũ cùng ngày)',
    description: '409 nếu có lịch hẹn rơi ra ngoài giờ ca mới.',
    body: obj({
      doctor_id: int('Bác sĩ'), from: day('Từ ngày'), to: day('Đến ngày, mặc định = from'),
      start_time: hhmm('Giờ bắt đầu'), end_time: hhmm('Giờ kết thúc'),
      weekdays: arr(int('1 = thứ Hai … 7 = Chủ nhật', { minimum: 1, maximum: 7 }), 'Các thứ trong tuần, mặc định cả tuần'),
    }, ['doctor_id', 'from', 'start_time', 'end_time']),
    status: 201,
  },
  'DELETE /api/shifts/:id': { summary: 'Xóa một ca (409 nếu ca đã có lịch hẹn)' },
  'GET /api/catalog': { summary: 'Toàn bộ danh mục: dịch vụ, ghế, lý do hủy, thuốc & vật tư, định mức' },
  'POST /api/catalog/services': {
    summary: 'Thêm dịch vụ',
    body: obj({ code: str('Mã (viết hoa)', { example: 'TAY_TRANG' }), name: str('Tên'), kind: oneOf('Loại', ['single', 'plan']) }, ['code', 'name']),
    status: 201,
  },
  'PATCH /api/catalog/services/:id': { summary: 'Đổi tên / ngừng dịch vụ', body: obj({ name: str('Tên'), is_active: bool('Còn dùng') }, ['name']) },
  'POST /api/catalog/chairs': { summary: 'Thêm ghế', body: obj({ name: str('Tên ghế') }, ['name']), status: 201 },
  'PATCH /api/catalog/chairs/:id': { summary: 'Sửa ghế', body: obj({ name: str('Tên ghế'), is_active: bool('Còn dùng') }, ['name']) },
  'POST /api/catalog/cancel-reasons': { summary: 'Thêm lý do hủy', body: obj({ name: str('Lý do') }, ['name']), status: 201 },
  'PATCH /api/catalog/cancel-reasons/:id': { summary: 'Sửa lý do hủy', body: obj({ name: str('Lý do'), is_active: bool('Còn dùng') }, ['name']) },
  'POST /api/catalog/items': { summary: 'Thêm thuốc / vật tư', body: { $ref: '#/components/schemas/ItemInput' }, status: 201 },
  'PATCH /api/catalog/items/:id': { summary: 'Sửa thuốc / vật tư', body: { $ref: '#/components/schemas/ItemInput' } },
  'PUT /api/catalog/supplies': {
    summary: 'Đặt định mức vật tư cho một lần làm dịch vụ',
    body: obj({ service_id: int('Dịch vụ'), item_id: int('Vật tư'), quantity: num('Định mức', { exclusiveMinimum: 0 }) }, ['service_id', 'item_id', 'quantity']),
  },
  'DELETE /api/catalog/supplies': { summary: 'Bỏ định mức vật tư', query: [q('service_id', int('Dịch vụ'), true), q('item_id', int('Vật tư'), true)] },
  'GET /api/staff': { summary: 'Danh sách nhân viên' },
  'POST /api/staff': {
    summary: 'Tạo tài khoản nhân viên',
    body: obj({ full_name: str('Họ tên'), username: str('Tên đăng nhập'), password: str('Mật khẩu: 8–128 ký tự, có chữ và số', { format: 'password' }),
      role: oneOf('Vai trò', ['receptionist', 'dentist', 'manager']), phone: str('SĐT') }, ['full_name', 'username', 'password', 'role']),
    status: 201,
  },
  'PATCH /api/staff/:id': {
    summary: 'Sửa / khóa tài khoản, đặt lại mật khẩu',
    description: 'Đặt lại mật khẩu hoặc khóa tài khoản → các phiên cũ của nhân viên đó bị từ chối ngay. Không tự khóa / tự đổi vai trò của chính mình.',
    body: obj({ full_name: str('Họ tên'), phone: str('SĐT'), role: oneOf('Vai trò', ['receptionist', 'dentist', 'manager']),
      is_active: bool('Còn hoạt động', { default: true }), password: str('Mật khẩu mới (bỏ trống nếu không đổi)', { format: 'password' }) },
    ['full_name', 'role']),
  },
  'GET /api/inventory': { summary: 'Tồn kho (cảnh báo dưới ngưỡng) và phiếu nhập / xuất gần đây' },
  'POST /api/inventory/movements': {
    summary: 'Nhập kho, xuất tay, điều chỉnh tồn',
    description: 'receipt: số dương; manual_out: số dương (trừ kho); adjustment: âm hoặc dương. Không phải nhập kho thì bắt buộc ghi chú.',
    body: obj({ item_id: int('Thuốc / vật tư'), movement_type: oneOf('Loại phiếu', ['receipt', 'manual_out', 'adjustment']),
      quantity: num('Số lượng'), note: str('Ghi chú') }, ['item_id', 'movement_type', 'quantity']),
    status: 201,
  },

  // Báo cáo ----------------------------------------------------------
  'GET /api/dashboard': { summary: 'Trang tổng quan (bác sĩ chỉ thấy số liệu của mình)' },
  'GET /api/reports': { summary: 'Danh sách báo cáo quản lý' },
  'GET /api/reports/:key': {
    summary: 'Một báo cáo: cột, dòng, dữ liệu biểu đồ',
    params: { key: oneOf('Mã báo cáo', REPORT_KEYS) },
    query: [q('month', str('Tháng YYYY-MM, mặc định tháng này', { pattern: '^\\d{4}-\\d{2}$', example: '2026-11' }))],
  },
};

const ERROR_TEXT = {
  400: 'Dữ liệu không hợp lệ',
  401: 'Chưa đăng nhập, token sai / hết hạn, tài khoản bị khóa hoặc mật khẩu đã đổi',
  403: 'Đã đăng nhập nhưng vai trò không có mã quyền của endpoint',
  404: 'Không tìm thấy',
  409: 'Vi phạm quy tắc nghiệp vụ (trùng lịch, đã thu tiền, đã chốt két…)',
  429: 'Sai mật khẩu quá nhiều lần, xem header Retry-After',
};

const COMPONENTS = {
  securitySchemes: {
    bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Token từ POST /api/auth/token' },
    cookieAuth: { type: 'apiKey', in: 'cookie', name: 'clinic_token', description: 'Cookie do POST /api/auth/login đặt (trình duyệt tự gửi)' },
  },
  schemas: {
    Error: obj({ error: str('Thông báo lỗi (tiếng Việt)') }, ['error']),
    User: obj({
      id: int('Mã nhân viên'), full_name: str('Họ tên'), username: str('Tên đăng nhập'),
      role: oneOf('Vai trò', ['receptionist', 'dentist', 'manager']), role_name: str('Tên vai trò'),
      permissions: arr(str('Mã quyền'), 'Mã quyền của vai trò'),
    }, ['id', 'full_name', 'username', 'role', 'role_name', 'permissions']),
    TokenResponse: obj({
      access_token: str('JWT (HS256)'), token_type: str('Luôn là Bearer', { enum: ['Bearer'] }),
      expires_in: int('Số giây còn hiệu lực', { example: TOKEN_TTL_SECONDS }), user: { $ref: '#/components/schemas/User' },
    }, ['access_token', 'token_type', 'expires_in', 'user']),
    Role: obj({
      code: oneOf('Mã vai trò', ['receptionist', 'dentist', 'manager']), name: str('Tên'), description: str('Mô tả'),
      active_staff: int('Số nhân viên đang hoạt động'), permissions: arr(str('Mã quyền')),
    }),
    Permission: obj({ code: str('Mã quyền'), module: str('Nhóm'), description: str('Mô tả'), roles: arr(str('Vai trò đang có quyền')) }),
    LoginAttempt: obj({
      id: int('Mã'), created_at: str('Thời điểm', { format: 'date-time' }), username: str('Tên đăng nhập đã nhập'),
      staff_name: str('Nhân viên (nếu tài khoản có thật)'), ip: str('IP'), user_agent: str('Trình duyệt / ứng dụng'),
      method: oneOf('Cách đăng nhập', ['cookie', 'token']), success: bool('Thành công'),
      reason: oneOf('Lý do thất bại', ['wrong_password', 'unknown_user', 'inactive', 'locked']),
    }),
    ItemInput: obj({
      kind: oneOf('Loại', ['medicine', 'supply']), name: str('Tên'), unit: str('Đơn vị tính', { example: 'viên' }),
      reorder_threshold: num('Ngưỡng cảnh báo tồn', { minimum: 0 }), sale_price: money('Giá bán (chỉ thuốc)'),
    }, ['kind', 'name', 'unit']),
  },
};

const INTRO = `API phòng khám Nha khoa Nụ Cười Việt (Express + PostgreSQL; xác thực & phân quyền dùng Prisma).

### Xác thực
1. **Swagger / Postman:** gọi \`POST /api/auth/token\` → chép \`access_token\` → bấm **Authorize** → dán vào *bearerAuth*.
2. **Trình duyệt:** \`POST /api/auth/login\` đặt cookie \`clinic_token\`; các request sau trên cùng domain tự gửi cookie.

Token hạn ${TOKEN_TTL_SECONDS / 3600} giờ. Đổi mật khẩu, khóa tài khoản → token cũ bị từ chối ngay (API đọc lại tài khoản mỗi request).

### Phân quyền
Mỗi endpoint yêu cầu **một mã quyền** (dòng *Quyền* trong mô tả, trường \`x-permission\`). Vai trò nào có mã quyền nào nằm trong bảng
\`role_permission\`, quản lý sửa qua \`PUT /api/roles/{role}/permissions\`; tài liệu này đọc bảng đó mỗi lần mở nên luôn khớp thực tế.

| Mã | Ý nghĩa |
|---|---|
| 401 | ${ERROR_TEXT[401]} |
| 403 | ${ERROR_TEXT[403]} |
| 429 | ${ERROR_TEXT[429]} |`;

// ---------------------------------------------------------------------
// Sinh spec
// ---------------------------------------------------------------------
const toOpenApiPath = (p) => p.replace(/:(\w+)/g, '{$1}');

// Liệt kê route của các router (mount: tiền tố dưới /api)
export function listRoutes(mounts) {
  const out = [];
  for (const [prefix, router] of mounts) {
    for (const layer of router.stack) {
      if (!layer.route) continue;
      const path = `${prefix}${layer.route.path === '/' ? '' : layer.route.path}` || '/';
      const guard = layer.route.stack.find((l) => l.handle.permission);
      for (const method of Object.keys(layer.route.methods)) {
        out.push({ method: method.toUpperCase(), path, permission: guard?.handle.permission ?? null });
      }
    }
  }
  return out;
}

export const routeDocKey = (r) => `${r.method} ${r.path}`;
export const documentedKeys = () => Object.keys(ROUTE_DOCS);

function responseFor(doc) {
  const status = doc.status ?? 200;
  if (status === 204) return { 204: { description: 'Thành công, không có nội dung' } };
  const schema = doc.response ?? { type: 'object', description: 'Dữ liệu JSON' };
  return { [status]: { description: 'Thành công', content: { 'application/json': { schema } } } };
}

export async function buildOpenApi({ authRoutes, mounts }) {
  const [permissions, roles] = await Promise.all([
    prisma.permission.findMany({ select: { code: true, module: true, description: true, role_permission: { select: { role: true } } } }),
    prisma.role.findMany({ select: { code: true, name: true } }),
  ]);
  const roleName = Object.fromEntries(roles.map((r) => [r.code, r.name]));
  const perm = Object.fromEntries(permissions.map((p) => [p.code, p]));
  const routes = [...listRoutes([['/auth', authRoutes]]), ...listRoutes(mounts)]
    .map((r) => ({ ...r, path: `/api${r.path === '/' ? '' : r.path}` }));

  const tags = ['Xác thực', ...new Set(permissions.map((p) => p.module))];
  const paths = {};
  for (const r of routes) {
    const doc = ROUTE_DOCS[routeDocKey(r)] ?? { summary: `${r.method} ${r.path}`, undocumented: true };
    const p = r.permission ? perm[r.permission] : null;
    const granted = p ? p.role_permission.map((g) => roleName[g.role] ?? g.role) : [];
    const access = doc.public
      ? '**Quyền:** công khai (không cần đăng nhập).'
      : r.permission
        ? `**Quyền:** \`${r.permission}\` — ${p?.description ?? 'mã quyền chưa có trong DB'}.\n\n**Vai trò đang có quyền:** ${granted.join(', ') || 'chưa vai trò nào'}.`
        : '**Quyền:** chỉ cần đăng nhập.';
    const pathParams = [...r.path.matchAll(/:(\w+)/g)].map(([, name]) => ({
      name, in: 'path', required: true,
      schema: doc.params?.[name] ?? (name === 'role' || name === 'key' ? str(ID_PARAM_NAMES[name]) : int(ID_PARAM_NAMES[name] ?? name)),
    }));
    const errors = doc.errors ?? (doc.public ? [400] : [400, 401, 403, 404, 409]);
    const op = {
      tags: [p?.module ?? 'Xác thực'],
      summary: doc.summary,
      description: [doc.description, access].filter(Boolean).join('\n\n'),
      operationId: `${r.method.toLowerCase()}${r.path.replace(/^\/api/, '').replace(/[/:-](\w)/g, (_, c) => c.toUpperCase())}`,
      ...(doc.public && { security: [] }),
      ...(r.permission && { 'x-permission': r.permission, 'x-roles': p?.role_permission.map((g) => g.role) ?? [] }),
      ...(doc.undocumented && { 'x-undocumented': true }),
      parameters: [...pathParams, ...(doc.query ?? [])],
      ...(doc.body && { requestBody: { required: true, content: { 'application/json': { schema: doc.body } } } }),
      responses: {
        ...responseFor(doc),
        ...Object.fromEntries(errors.map((code) => [code, {
          description: ERROR_TEXT[code], content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        }])),
      },
    };
    paths[toOpenApiPath(r.path)] = { ...paths[toOpenApiPath(r.path)], [r.method.toLowerCase()]: op };
  }

  return {
    openapi: '3.1.0',
    info: { title: 'Phòng khám Nha khoa Nụ Cười Việt — API', version: '1.1.0', description: INTRO },
    servers: [{ url: '/', description: 'Máy chủ đang mở tài liệu này' }],
    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
    tags: tags.map((name) => ({ name })),
    paths,
    components: COMPONENTS,
  };
}

// Swagger UI (bản dựng sẵn từ jsDelivr, khóa phiên bản) đọc /api/openapi.json cùng domain
const SWAGGER_UI = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.33.3';
export const SWAGGER_HTML = `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>API phòng khám — Swagger</title>
  <link rel="stylesheet" href="${SWAGGER_UI}/swagger-ui.css">
  <style>body { margin: 0; background: #fafafa; } .swagger-ui .topbar { display: none; }</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="${SWAGGER_UI}/swagger-ui-bundle.js" crossorigin></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: '/api/openapi.json',
      dom_id: '#swagger-ui',
      persistAuthorization: true,
      withCredentials: true,
      docExpansion: 'none',
      filter: true,
      tryItOutEnabled: true,
    });
  </script>
</body>
</html>`;
