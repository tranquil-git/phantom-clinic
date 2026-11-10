export const ROLE = { receptionist: 'receptionist', dentist: 'dentist', manager: 'manager' };

export const ROLE_LABEL = { receptionist: 'Lễ tân', dentist: 'Bác sĩ', manager: 'Quản lý' };
export const APPT_STATUS = { booked: 'Đã đặt', checked_in: 'Đã tiếp đón', no_show: 'Không đến', cancelled: 'Đã hủy' };
export const REMINDER_RESULT = {
  confirmed: 'Đã xác nhận', wants_reschedule: 'Xin đổi lịch', wants_cancel: 'Xin hủy',
  no_answer: 'Không nghe máy', sms_sent: 'Đã gửi SMS', sms_failed: 'SMS lỗi',
};
export const PAY_METHOD = { cash: 'Tiền mặt', transfer: 'Chuyển khoản' };
export const PLAN_STATUS = { active: 'Đang điều trị', completed: 'Hoàn tất', cancelled: 'Đã hủy' };
export const MOVEMENT_TYPE = {
  receipt: 'Nhập kho', treatment: 'Dùng theo phiếu', dispense: 'Cấp thuốc', manual_out: 'Xuất thủ công', adjustment: 'Điều chỉnh kiểm kê',
};
export const GENDER = { male: 'Nam', female: 'Nữ', other: 'Khác' };
export const SERVICE_KIND = { single: 'Dịch vụ lẻ', plan: 'Liệu trình' };
export const ITEM_KIND = { medicine: 'Thuốc', supply: 'Vật tư' };
export const TABLE_LABEL = {
  treatment_record: 'Phiếu', treatment_line: 'Dòng việc', prescription_item: 'Đơn thuốc', treatment_plan: 'Liệu trình',
};
export const ACTION_LABEL = { INSERT: 'Thêm', UPDATE: 'Sửa', DELETE: 'Xóa' };

const money = new Intl.NumberFormat('vi-VN');
export const vnd = (n) => (n === null || n === undefined ? '—' : `${money.format(n)} ₫`);
export const num = (n) => (n === null || n === undefined ? '—' : money.format(n));

export function fmtDate(d) {
  if (!d) return '—';
  const [y, m, day] = String(d).slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
}

export function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

export function fmtTime(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export const todayLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());

export function addDays(d, n) {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export const weekday = (d) => ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][new Date(`${d}T00:00:00Z`).getUTCDay()];

export function age(dob) {
  if (!dob) return null;
  const [y, m, d] = dob.split('-').map(Number);
  const [Y, M, D] = todayLocal().split('-').map(Number);
  return Y - y - (M < m || (M === m && D < d) ? 1 : 0);
}

export function toothLabel(code) {
  return { '00': 'Cả miệng', '01': 'Hàm trên', '02': 'Hàm dưới' }[code] ?? `Răng ${code}`;
}

// Khung 30 phút trong giờ mở cửa: 8h–20h, Chủ nhật 8h–17h
export function clinicSlots(d) {
  const sunday = new Date(`${d}T00:00:00Z`).getUTCDay() === 0;
  const last = sunday ? 16 * 60 + 30 : 19 * 60 + 30;
  const out = [];
  for (let m = 8 * 60; m <= last; m += 30) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  return out;
}
