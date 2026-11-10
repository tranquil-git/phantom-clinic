-- =====================================================================
-- 001 — Xác thực & phân quyền API (RBAC)
--   role / permission / role_permission : vai trò nào được gọi API nào (sửa được qua API, không cần sửa code)
--   login_attempt                       : nhật ký đăng nhập + chặn dò mật khẩu
--   staff.password_changed_at           : đổi mật khẩu → mọi token cũ hết hiệu lực
-- Chạy bằng: cd backend; npm run db:migrate (máy) / npm run db:deploy (production).
-- Quyền mặc định dưới đây giữ đúng phân quyền cũ (requireRole trong code trước bản này).
-- Không tự BEGIN/COMMIT: scripts/migrate.js bọc cả file + dòng ghi nhận trong một transaction.
-- =====================================================================

-- Ba vai trò cố định (enum staff_role); bảng này thêm tên hiển thị và là gốc của ma trận quyền
CREATE TABLE role (
    code        staff_role PRIMARY KEY,
    name        text NOT NULL,
    description text NOT NULL
);
COMMENT ON TABLE role IS 'Vai trò nhân viên (cố định 3 vai trò), dùng cho phân quyền API';

INSERT INTO role (code, name, description) VALUES
    ('receptionist', 'Lễ tân',  'Tiếp đón, đặt lịch, gọi nhắc, lập hóa đơn, thu tiền, chốt két'),
    ('dentist',      'Bác sĩ',  'Khám, ghi phiếu điều trị, kê đơn, lập liệu trình'),
    ('manager',      'Quản lý', 'Danh mục, giá, ca trực, kho, nhân viên, báo cáo, phân quyền');

ALTER TABLE staff ADD CONSTRAINT staff_role_fkey FOREIGN KEY (role) REFERENCES role (code);

CREATE TABLE permission (
    code        text PRIMARY KEY CHECK (code ~ '^[a-z]+\.[a-z_]+$'),
    module      text NOT NULL,
    description text NOT NULL
);
COMMENT ON TABLE permission IS 'Quyền gọi API; mỗi endpoint yêu cầu đúng một mã quyền (authorize() trong backend)';

CREATE TABLE role_permission (
    role            staff_role  NOT NULL REFERENCES role (code),
    permission_code text        NOT NULL REFERENCES permission (code) ON UPDATE CASCADE ON DELETE CASCADE,
    granted_by      bigint      REFERENCES staff (id),
    granted_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (role, permission_code)
);
COMMENT ON TABLE role_permission IS 'Ma trận phân quyền: vai trò được cấp quyền nào';

-- Quản lý luôn giữ quyền phân quyền, tránh tự khóa cả hệ thống
CREATE FUNCTION role_permission_keep_admin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.role = 'manager' AND OLD.permission_code IN ('permission.read', 'permission.manage') THEN
        RAISE EXCEPTION 'Không thể thu hồi quyền % của Quản lý (sẽ không ai phân quyền được nữa)', OLD.permission_code;
    END IF;
    RETURN OLD;
END $$;
CREATE TRIGGER role_permission_keep_admin BEFORE DELETE ON role_permission
    FOR EACH ROW EXECUTE FUNCTION role_permission_keep_admin();

INSERT INTO permission (code, module, description) VALUES
    ('patient.read',        'Bệnh nhân',     'Tìm, xem hồ sơ bệnh nhân'),
    ('patient.write',       'Bệnh nhân',     'Thêm, sửa thông tin bệnh nhân'),
    ('appointment.read',    'Lịch hẹn',      'Xem lịch hẹn theo ngày'),
    ('appointment.create',  'Lịch hẹn',      'Xem khung giờ trống, đặt lịch hẹn'),
    ('appointment.walk_in', 'Lịch hẹn',      'Tiếp nhận khách không hẹn (đặt và check-in ngay)'),
    ('appointment.manage',  'Lịch hẹn',      'Dời, hủy, check-in, đánh dấu không đến'),
    ('reminder.manage',     'Lịch hẹn',      'Danh sách gọi nhắc lịch, ghi kết quả gọi'),
    ('queue.read',          'Điều trị',      'Xem hàng chờ khám'),
    ('record.read',         'Điều trị',      'Xem phiếu điều trị'),
    ('record.write',        'Điều trị',      'Mở, sửa phiếu điều trị, ghi việc đã làm, kê đơn'),
    ('plan.read',           'Điều trị',      'Xem liệu trình'),
    ('plan.write',          'Điều trị',      'Lập, cập nhật liệu trình'),
    ('invoice.list',        'Thu ngân',      'Danh sách chờ lập hóa đơn, danh sách hóa đơn'),
    ('invoice.read',        'Thu ngân',      'Xem chi tiết hóa đơn'),
    ('invoice.create',      'Thu ngân',      'Xem trước và lập hóa đơn (lượt khám, đợt liệu trình)'),
    ('payment.create',      'Thu ngân',      'Ghi nhận thu tiền'),
    ('cash.read',           'Thu ngân',      'Xem chốt két'),
    ('cash.close',          'Thu ngân',      'Chốt két cuối ngày'),
    ('lookup.read',         'Danh mục',      'Dữ liệu dùng chung: ghế, bác sĩ, dịch vụ, lý do hủy, thuốc'),
    ('price.read',          'Danh mục',      'Xem bảng giá dịch vụ'),
    ('price.write',         'Danh mục',      'Đặt giá mới cho dịch vụ'),
    ('catalog.manage',      'Danh mục',      'Quản lý dịch vụ, ghế, lý do hủy, thuốc & vật tư, định mức'),
    ('shift.read',          'Nhân sự',       'Xem ca trực bác sĩ'),
    ('shift.write',         'Nhân sự',       'Xếp, xóa ca trực'),
    ('staff.manage',        'Nhân sự',       'Quản lý tài khoản nhân viên, xem nhật ký đăng nhập'),
    ('inventory.manage',    'Kho',           'Xem tồn kho, nhập / xuất / điều chỉnh kho'),
    ('dashboard.read',      'Báo cáo',       'Trang tổng quan'),
    ('report.read',         'Báo cáo',       'Báo cáo quản lý (Q1–Q8)'),
    ('permission.read',     'Phân quyền',    'Xem vai trò và ma trận phân quyền'),
    ('permission.manage',   'Phân quyền',    'Cấp, thu hồi quyền của vai trò');

INSERT INTO role_permission (role, permission_code)
SELECT r.role::staff_role, p.code
FROM (VALUES
    ('receptionist', ARRAY['patient.read', 'patient.write', 'appointment.read', 'appointment.create', 'appointment.walk_in',
                           'appointment.manage', 'reminder.manage', 'record.read', 'plan.read', 'invoice.list', 'invoice.read',
                           'invoice.create', 'payment.create', 'cash.read', 'cash.close', 'lookup.read', 'price.read',
                           'dashboard.read']),
    ('dentist',      ARRAY['patient.read', 'appointment.read', 'appointment.create', 'queue.read', 'record.read', 'record.write',
                           'plan.read', 'plan.write', 'invoice.read', 'lookup.read', 'price.read', 'shift.read', 'dashboard.read']),
    ('manager',      ARRAY['patient.read', 'appointment.read', 'queue.read', 'record.read', 'plan.read', 'invoice.list',
                           'invoice.read', 'cash.read', 'lookup.read', 'price.read', 'price.write', 'catalog.manage',
                           'shift.read', 'shift.write', 'staff.manage', 'inventory.manage', 'dashboard.read', 'report.read',
                           'permission.read', 'permission.manage'])
) AS r (role, codes)
CROSS JOIN LATERAL unnest(r.codes) AS c (code)
JOIN permission p ON p.code = c.code;

-- Đổi mật khẩu (API, quản lý đặt lại, script set-password) → token phát trước thời điểm này bị từ chối.
-- API tự ghi thời điểm (tính theo giây, cùng đồng hồ với "iat" của JWT mới phát); câu UPDATE khác thì trigger ghi now().
ALTER TABLE staff ADD COLUMN password_changed_at timestamptz NOT NULL DEFAULT now();
UPDATE staff SET password_changed_at = created_at;

CREATE FUNCTION staff_password_changed() RETURNS trigger LANGUAGE plpgsql AS $
BEGIN
    IF NEW.password_hash IS DISTINCT FROM OLD.password_hash
       AND NEW.password_changed_at IS NOT DISTINCT FROM OLD.password_changed_at THEN
        NEW.password_changed_at := now();
    END IF;
    RETURN NEW;
END $;
CREATE TRIGGER staff_password_changed BEFORE UPDATE OF password_hash ON staff
    FOR EACH ROW EXECUTE FUNCTION staff_password_changed();

-- Nhật ký đăng nhập; đếm lần sai gần đây để tạm khóa (đếm trong DB nên đúng cả khi API chạy nhiều instance)
CREATE TABLE login_attempt (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username   text        NOT NULL,
    staff_id   bigint      REFERENCES staff (id),
    ip         text,
    user_agent text,
    method     text        NOT NULL CHECK (method IN ('cookie', 'token')),
    success    boolean     NOT NULL,
    reason     text        CHECK (reason IN ('wrong_password', 'unknown_user', 'inactive', 'locked')),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (success = (reason IS NULL))
);
CREATE INDEX login_attempt_username_recent ON login_attempt (username, created_at DESC);
CREATE INDEX login_attempt_ip_recent       ON login_attempt (ip, created_at DESC);
COMMENT ON TABLE login_attempt IS 'Nhật ký đăng nhập; quá 5 lần sai / 15 phút cho một tài khoản từ một IP thì tạm khóa';

