-- Dữ liệu mẫu TranquilClinicDB. Chỉ chạy trên database vừa tạo bảng (bảng còn trống),
-- vì các khóa ngoại dưới đây dùng id sinh theo thứ tự chèn.
-- "Hôm nay" của dữ liệu mẫu: 2026-11-03.

BEGIN;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM staff) THEN
        RAISE EXCEPTION 'Database đã có dữ liệu — seed.sql chỉ chạy trên database trống';
    END IF;
END
$$;

SET LOCAL app.staff_id = '4';   -- quản lý khai báo danh mục

-- ---------------------------------------------------------------------
-- Nhân sự: 2 lễ tân, 4 bác sĩ (BS Dũng bán thời gian T2/T4/T6), 1 quản lý
-- Mật khẩu mẫu của mọi tài khoản: Demo@123 (băm scrypt). Đổi bằng: cd backend && npm run set-password -- <username> <mật khẩu>
-- ---------------------------------------------------------------------
INSERT INTO staff (full_name, phone, role, username, password_hash) VALUES
    ('Nguyễn Thị Lan',  '0905111001', 'receptionist', 'lan',  'scrypt$CLPpyeWGrp2AV2ksb/LL1g==$Qf/xsi1OpNY1qkNtijhVfQxDkTrqRRoFDqjoLINmonOSfkdnHKnJIJCytEAQ6hOM9S4uugvq7HmAsmIIVCoMeQ=='),   -- 1 ca sáng
    ('BS Trần Văn An',  '0905111002', 'dentist',      'an',   'scrypt$pDYoBVvK9QYOKR+qx+IoCA==$hevpi1ZFz0a+lQarjgoyzxO0FssvoVZUZYD1GLYqnm/FlpHQt2ywDZBAFSRldsAToRuIM6jlpbvnYp+8uLIsVg=='),   -- 2
    ('BS Lê Thị Bình',  '0905111003', 'dentist',      'binh', 'scrypt$NTBPIi5XMj2OMihSlh/b2A==$VeBcPTIb3GG2lNxRIEem/rn9Pub5ypoCWiCwCjvdclTzHH07wrxBcBvzoBF2GGHBitmmz9mTNYEMSqztC8s0bA=='),   -- 3 ca sáng
    ('Phạm Quốc Hùng',  '0905111004', 'manager',      'hung', 'scrypt$yc4ZXNt4k2SGeXof3y3HjA==$E2+0quk0Q6vX44gcpqvP0kc6Fz9GPADabV34YihMZwX9O00omRW9de1m4vE7vd/rnfvZla2qz1Y1ZQO3mMieoQ=='),   -- 4
    ('Võ Thị Hoa',      '0905111005', 'receptionist', 'hoa',  'scrypt$X0QMk8hqjwVLM5JCnQbt6w==$hTTs2OharCF7MJqyCvEMDePnDGLQOs9vfzuCajB6x+yrYyyp1NGShy1r2lhP5Q7keirGH2jZFkXbOKwwJlEcEQ=='),   -- 5 ca chiều
    ('BS Đặng Minh Chi', '0905111006', 'dentist',     'chi',  'scrypt$pM3tjyCrIzD4LBzZYhTlGQ==$A9dCsO7L75ToTzQqVe1VSoOTC+zL3+9Ta56tDsu1s/RChc/E/G8DmDuDlNegIuTPNv5yID9wP3+SOGqWgFd8zg=='),   -- 6 ca chiều
    ('BS Huỳnh Văn Dũng', '0905111007', 'dentist',    'dung', 'scrypt$PFCP2kWqUbgIGnclDr84XA==$DRqQYPTUGcmRdwnCWjct7DrC2ZTDMyGLshTMi3gxWfnL6XhzuOlwFmnMZvpE3aSF0c061y+O2Du7siRsmm7zYA==');   -- 7 bán thời gian

INSERT INTO chair (name) VALUES ('Ghế 1'), ('Ghế 2'), ('Ghế 3');

-- Ca trực 01/03 – 31/12/2026
INSERT INTO doctor_shift (doctor_id, shift_date, start_time, end_time, created_by)
SELECT 2, d::date, '08:00', CASE WHEN extract(isodow FROM d) = 7 THEN time '17:00' ELSE time '20:00' END, 4
FROM generate_series('2026-03-01'::date, '2026-12-31'::date, interval '1 day') d;

INSERT INTO doctor_shift (doctor_id, shift_date, start_time, end_time, created_by)
SELECT 3, d::date, '08:00', '14:00', 4
FROM generate_series('2026-03-01'::date, '2026-12-31'::date, interval '1 day') d;

INSERT INTO doctor_shift (doctor_id, shift_date, start_time, end_time, created_by)
SELECT 6, d::date, '14:00', CASE WHEN extract(isodow FROM d) = 7 THEN time '17:00' ELSE time '20:00' END, 4
FROM generate_series('2026-03-01'::date, '2026-12-31'::date, interval '1 day') d;

INSERT INTO doctor_shift (doctor_id, shift_date, start_time, end_time, created_by)
SELECT 7, d::date, '08:00', '20:00', 4
FROM generate_series('2026-03-01'::date, '2026-12-31'::date, interval '1 day') d
WHERE extract(isodow FROM d) IN (1, 3, 5);

-- ---------------------------------------------------------------------
-- Danh mục
-- ---------------------------------------------------------------------
INSERT INTO service (code, name, kind) VALUES
    ('KHAM',      'Khám tổng quát',        'single'),   -- 1
    ('CAO_VOI',   'Cạo vôi',               'single'),   -- 2
    ('TRAM',      'Trám răng composite',   'single'),   -- 3
    ('NHO',       'Nhổ răng sữa',          'single'),   -- 4
    ('NIENG',     'Niềng răng mắc cài',    'plan'),     -- 5
    ('IMPLANT',   'Cấy ghép implant',      'plan'),     -- 6
    ('TAY_TRANG', 'Tẩy trắng răng',        'single'),   -- 7
    ('LAY_TUY',   'Điều trị tủy',          'single');   -- 8

-- Giá trám đổi từ 01/11/2026 (LN-05)
INSERT INTO service_price (service_id, effective_from, price, created_by) VALUES
    (1, '2026-01-01',  100000, 4),
    (2, '2026-01-01',  200000, 4),
    (3, '2026-01-01',  300000, 4),
    (3, '2026-11-01',  350000, 4),
    (4, '2026-01-01',  150000, 4),
    (7, '2026-01-01', 1500000, 4),
    (8, '2026-01-01',  800000, 4);

INSERT INTO cancel_reason (name) VALUES
    ('Bận việc'), ('Ốm'), ('Chi phí'), ('Phòng khám đổi lịch'), ('Khác');

INSERT INTO inventory_item (kind, name, unit, reorder_threshold, sale_price) VALUES
    ('medicine', 'Amoxicillin 500mg',  'viên', 20, 5000),   -- 1
    ('supply',   'Composite A2',       'tuýp',  2, NULL),   -- 2
    ('supply',   'Găng tay',           'đôi',  10, NULL),   -- 3
    ('medicine', 'Paracetamol 500mg',  'viên', 30, 2000),   -- 4
    ('supply',   'Thuốc tê Lidocaine', 'ống',  10, NULL),   -- 5
    ('supply',   'Kim tiêm nha khoa',  'cái',  20, NULL);   -- 6

-- Định mức vật tư cho một lần làm (GT-08)
INSERT INTO service_supply (service_id, item_id, quantity) VALUES
    (2, 3, 2),                       -- cạo vôi: găng
    (3, 2, 1), (3, 3, 2),            -- trám: composite, găng
    (4, 3, 2), (4, 5, 1), (4, 6, 1), -- nhổ: găng, thuốc tê, kim
    (8, 3, 2), (8, 5, 1), (8, 6, 1); -- điều trị tủy: găng, thuốc tê, kim

INSERT INTO stock_movement (item_id, movement_type, quantity, note, created_by) VALUES
    (1, 'receipt',     25, 'Nhập đầu kỳ', 4),
    (2, 'receipt',      3, 'Nhập đầu kỳ', 4),
    (3, 'receipt',    100, 'Nhập đầu kỳ', 4),
    (4, 'receipt',    100, 'Nhập đầu kỳ', 4),
    (5, 'receipt',     30, 'Nhập đầu kỳ', 4),
    (6, 'receipt',     50, 'Nhập đầu kỳ', 4),
    (3, 'manual_out',  -4, 'Găng rách khi mở hộp', 4),
    (6, 'adjustment',  -1, 'Kiểm kê thiếu 1 cái', 4);

-- ---------------------------------------------------------------------
-- Bệnh nhân: mẹ + hai con dùng chung SĐT (mục 3.2)
-- ---------------------------------------------------------------------
SET LOCAL app.staff_id = '1';

INSERT INTO patient (full_name, date_of_birth, gender, contact_phone, guardian_name, guardian_relation,
                     paper_record_no, medical_note, created_by) VALUES
    ('Nguyễn Thị Mai',  '1988-05-01', 'female', '0901234567', NULL, NULL, 'HS-2019-0087', NULL, 1),          -- 1
    ('Trần Minh Anh',   '2015-02-10', 'female', '0901234567', 'Nguyễn Thị Mai', 'mẹ', NULL, NULL, 1),        -- 2
    ('Trần Minh Thư',   '2018-07-20', 'female', '0901234567', 'Nguyễn Thị Mai', 'mẹ', NULL, NULL, 1),        -- 3
    ('Lê Văn Hải',      '1970-01-01', 'male',   '0912000111', NULL, NULL, 'HS-2020-1533', 'Cao huyết áp', 1),-- 4
    ('Phạm Thu Trang',  '2005-09-09', 'female', '0933000222', NULL, NULL, NULL, NULL, 1),                    -- 5
    ('Hoàng Văn Nam',   '1965-03-12', 'male',   '0977000333', NULL, NULL, 'HS-2019-0412', 'Dị ứng penicillin', 1), -- 6
    ('Đỗ Thị Hạnh',     '1992-11-30', 'female', '0988000444', NULL, NULL, NULL, NULL, 5),                    -- 7
    ('Ngô Minh Tuấn',   '1999-06-15', 'male',   '0966000555', NULL, NULL, NULL, NULL, 5);                    -- 8

-- ---------------------------------------------------------------------
-- Lịch hẹn
-- ---------------------------------------------------------------------
INSERT INTO appointment (patient_id, doctor_id, chair_id, appt_date, slot_time, planned_service_id,
                         status, checked_in_at, booked_by) VALUES
    (1, 2, 1, '2026-10-10', '09:00', 3, 'checked_in', '2026-10-10 08:55+07', 1),  -- 1  hai bác sĩ cùng làm
    (2, 3, 2, '2026-11-02', '10:00', 1, 'checked_in', '2026-11-02 09:55+07', 1),  -- 2
    (3, 2, 1, '2026-11-02', '10:00', 4, 'checked_in', '2026-11-02 09:55+07', 1),  -- 3
    (4, 2, 1, '2026-03-15', '09:00', 1, 'checked_in', '2026-03-15 08:55+07', 1),  -- 4  lâu chưa quay lại
    (1, 2, 1, '2026-11-05', '09:00', 1, 'booked',     NULL,                  1),  -- 5
    (5, 2, 2, '2026-10-20', '10:00', 5, 'checked_in', '2026-10-20 09:55+07', 1),  -- 6  niềng buổi 1
    (5, 2, 2, '2026-11-02', '11:00', 5, 'checked_in', '2026-11-02 10:55+07', 1),  -- 7  niềng buổi 2
    (4, 2, 3, '2026-11-01', '09:00', 1, 'no_show',    NULL,                  1);  -- 8  không đến

INSERT INTO appointment (patient_id, doctor_id, chair_id, appt_date, slot_time, planned_service_id, status,
                         cancel_reason_id, cancel_note, cancelled_by, cancelled_at, booked_by) VALUES
    (2, 2, 3, '2026-11-04', '15:00', 3, 'cancelled', 1, NULL, 1, '2026-11-03 09:00+07', 1),             -- 9
    (3, 2, 3, '2026-11-04', '15:30', 3, 'cancelled', 2, 'Bé sốt', 1, '2026-11-03 09:10+07', 1),         -- 10
    (1, 3, 3, '2026-11-06', '08:00', 2, 'cancelled', 1, NULL, 1, '2026-11-03 09:20+07', 1);             -- 11

INSERT INTO appointment (patient_id, doctor_id, chair_id, appt_date, slot_time, planned_service_id,
                         status, checked_in_at, booked_by) VALUES
    (1, 2, 1, '2026-11-03', '08:00', 3, 'checked_in', '2026-11-03 07:55+07', 1),  -- 12 trám theo giá mới
    (6, 7, 3, '2026-10-14', '09:00', 6, 'checked_in', '2026-10-14 08:50+07', 1),  -- 13 implant buổi 1 (T4)
    (6, 7, 3, '2026-11-02', '14:00', 6, 'checked_in', '2026-11-02 13:55+07', 5),  -- 14 implant buổi 2 (T2)
    (7, 6, 2, '2026-11-03', '15:00', 8, 'checked_in', '2026-11-03 14:58+07', 5),  -- 15 khách không hẹn (UC29)
    (8, 6, 1, '2026-11-04', '16:00', 7, 'booked',     NULL,                  5),  -- 16
    (2, 3, 2, '2026-11-04', '09:00', 1, 'booked',     NULL,                  1);  -- 17

-- Nhắc hẹn ngày mai (UC25, UC26)
INSERT INTO appointment_reminder (appointment_id, channel, result, note, created_by, created_at) VALUES
    (9,  'call', 'wants_cancel', 'Khách bận công tác', 1, '2026-11-03 08:55+07'),
    (16, 'call', 'confirmed',    NULL,                 5, '2026-11-03 15:10+07'),
    (17, 'call', 'no_answer',    NULL,                 1, '2026-11-03 09:30+07'),
    (17, 'sms',  'sms_sent',     'Gửi mẫu nhắc hẹn',   1, '2026-11-03 09:31+07');

-- ---------------------------------------------------------------------
-- Điều trị
-- ---------------------------------------------------------------------
SET LOCAL app.staff_id = '2';

INSERT INTO treatment_record (appointment_id, diagnosis, created_by) VALUES
    (1,  NULL,                              2),   -- 1
    (2,  'Răng khỏe, hẹn tái khám 6 tháng', 3),   -- 2
    (3,  'Răng sữa 75 lung lay',            2),   -- 3
    (4,  NULL,                              2),   -- 4
    (6,  'Răng chen chúc hàm dưới',         2),   -- 5
    (7,  NULL,                              2),   -- 6
    (12, 'Sâu răng 26',                     2),   -- 7
    (13, 'Mất răng 36',                     7),   -- 8
    (14, NULL,                              7),   -- 9
    (15, 'Viêm tủy răng 46',                6);   -- 10

INSERT INTO treatment_plan (patient_id, service_id, doctor_id, total_price, planned_sessions, started_on, created_by) VALUES
    (5, 5, 2, 30000000, 20, '2026-10-20', 2),   -- 1 niềng
    (6, 6, 7, 25000000,  3, '2026-10-14', 7);   -- 2 implant

INSERT INTO plan_installment (plan_id, installment_no, amount, due_date) VALUES
    (1, 1, 10000000, '2026-10-20'),   -- 1
    (1, 2, 10000000, '2027-01-20'),   -- 2
    (1, 3, 10000000, '2027-04-20'),   -- 3
    (2, 1, 15000000, '2026-10-14'),   -- 4
    (2, 2, 10000000, '2026-12-14');   -- 5

-- Mỗi việc ghi số răng (LN-04) và bác sĩ thực hiện (mục 3.1); lưu dòng thì kho tự trừ (LN-14).
-- app.staff_id = bác sĩ lập phiếu, để audit_log ghi đúng người nhập.
INSERT INTO treatment_line (record_id, service_id, tooth_code, doctor_id, plan_id, session_no) VALUES
    (1,  3, '16', 2, NULL, NULL),   -- 1  BS An trám
    (1,  2, '00', 3, NULL, NULL);   -- 2  BS Bình cạo vôi cùng lượt

SET LOCAL app.staff_id = '3';
INSERT INTO treatment_line (record_id, service_id, tooth_code, doctor_id, plan_id, session_no) VALUES
    (2,  1, '00', 3, NULL, NULL);   -- 3

SET LOCAL app.staff_id = '2';
INSERT INTO treatment_line (record_id, service_id, tooth_code, doctor_id, plan_id, session_no) VALUES
    (3,  4, '75', 2, NULL, NULL),   -- 4  răng sữa
    (4,  1, '00', 2, NULL, NULL),   -- 5
    (5,  5, '00', 2, 1,    1),      -- 6  niềng buổi 1
    (6,  5, '00', 2, 1,    2),      -- 7  niềng buổi 2
    (7,  3, '26', 2, NULL, NULL);   -- 8
INSERT INTO prescription_item (record_id, item_id, dosage, quantity, dispensed_in_clinic) VALUES
    (1,  1, '2 viên/ngày sau ăn, 5 ngày',            10, true);    -- 1 cấp tại chỗ

SET LOCAL app.staff_id = '7';
INSERT INTO treatment_line (record_id, service_id, tooth_code, doctor_id, plan_id, session_no) VALUES
    (8,  6, '36', 7, 2,    1),      -- 9  implant buổi 1
    (9,  6, '36', 7, 2,    2);      -- 10 implant buổi 2
INSERT INTO prescription_item (record_id, item_id, dosage, quantity, dispensed_in_clinic) VALUES
    (8,  4, '1 viên khi đau sau cấy ghép',            6, false);   -- 2 mua ngoài (BN dị ứng penicillin)

SET LOCAL app.staff_id = '6';
INSERT INTO treatment_line (record_id, service_id, tooth_code, doctor_id, plan_id, session_no) VALUES
    (10, 8, '46', 6, NULL, NULL),   -- 11
    (10, 1, '00', 6, NULL, NULL);   -- 12
INSERT INTO prescription_item (record_id, item_id, dosage, quantity, dispensed_in_clinic) VALUES
    (10, 4, '1 viên khi đau, tối đa 4 viên/ngày',    10, true);    -- 3 cấp tại chỗ

SET LOCAL app.staff_id = '2';

-- Sửa phiếu / liệu trình: trigger ghi audit_log (LN-13)
SET LOCAL app.change_reason = 'Bổ sung chẩn đoán sau khi chụp phim';
UPDATE treatment_record SET diagnosis = 'Sâu răng 16 mặt nhai' WHERE id = 1;
SET LOCAL app.change_reason = 'Thêm 2 buổi chỉnh khớp cắn';
UPDATE treatment_plan SET planned_sessions = 22 WHERE id = 1;
SET LOCAL app.change_reason = '';

-- ---------------------------------------------------------------------
-- Hóa đơn, thu tiền, chốt két
-- ---------------------------------------------------------------------
SET LOCAL app.staff_id = '1';

-- Hóa đơn 1: giảm 50.000 ở tổng, phân bổ xuống dòng theo tỷ lệ 300/200/50 (mục 3.3)
INSERT INTO invoice (kind, record_id, total_discount_amount, discount_reason, created_by, created_at)
VALUES ('visit', 1, 50000, 'Khách quen', 1, '2026-10-10 10:00+07');
INSERT INTO invoice_line (invoice_id, treatment_line_id, prescription_item_id, description,
                          quantity, unit_price, discount_amount, doctor_id) VALUES
    (1, 1, NULL, 'Trám răng 16',      1,  service_price_at(3, '2026-10-10'), 27273, 2),
    (1, 2, NULL, 'Cạo vôi',           1,  service_price_at(2, '2026-10-10'), 18182, 3),
    (1, NULL, 1, 'Amoxicillin 500mg', 10, 5000,                               4545, NULL);

INSERT INTO invoice (kind, record_id, created_by, created_at) VALUES
    ('visit', 2, 1, '2026-11-02 10:30+07'),   -- 2
    ('visit', 3, 1, '2026-11-02 10:35+07'),   -- 3
    ('visit', 4, 1, '2026-03-15 09:40+07');   -- 4
INSERT INTO invoice_line (invoice_id, treatment_line_id, description, unit_price, doctor_id) VALUES
    (2, 3, 'Khám tổng quát',   service_price_at(1, '2026-11-02'), 3),
    (3, 4, 'Nhổ răng sữa 75',  service_price_at(4, '2026-11-02'), 2),
    (4, 5, 'Khám tổng quát',   service_price_at(1, '2026-03-15'), 2);

-- Hóa đơn đợt liệu trình (LN-06): dòng không trỏ treatment_line, tính cho bác sĩ phụ trách
INSERT INTO invoice (kind, installment_id, created_by, created_at)
VALUES ('installment', 1, 1, '2026-10-20 10:40+07');   -- 5
INSERT INTO invoice_line (invoice_id, description, unit_price, doctor_id)
VALUES (5, 'Niềng răng mắc cài — đợt 1', 10000000, 2);

-- Hóa đơn 6: trám tháng 11 theo giá mới, chưa thu
INSERT INTO invoice (kind, record_id, created_by, created_at) VALUES ('visit', 7, 1, '2026-11-03 08:40+07');
INSERT INTO invoice_line (invoice_id, treatment_line_id, description, unit_price, doctor_id)
VALUES (6, 8, 'Trám răng 26', service_price_at(3, '2026-11-03'), 2);

INSERT INTO invoice (kind, installment_id, created_by, created_at)
VALUES ('installment', 4, 1, '2026-10-14 10:00+07');   -- 7
INSERT INTO invoice_line (invoice_id, description, unit_price, doctor_id)
VALUES (7, 'Cấy ghép implant — đợt 1', 15000000, 7);

-- Hóa đơn 8: khách không hẹn, có thuốc cấp tại chỗ
INSERT INTO invoice (kind, record_id, created_by, created_at) VALUES ('visit', 10, 5, '2026-11-03 15:50+07');
INSERT INTO invoice_line (invoice_id, treatment_line_id, prescription_item_id, description,
                          quantity, unit_price, doctor_id) VALUES
    (8, 11, NULL, 'Điều trị tủy răng 46', 1,  service_price_at(8, '2026-11-03'), 6),
    (8, 12, NULL, 'Khám tổng quát',       1,  service_price_at(1, '2026-11-03'), 6),
    (8, NULL, 3,  'Paracetamol 500mg',    10, 2000,                              NULL);

-- Một hóa đơn thu nhiều lần, mỗi lần ghi tiền mặt / chuyển khoản (LN-08)
INSERT INTO payment (invoice_id, amount, method, received_by, received_at) VALUES
    (1,   300000, 'cash',     1, '2026-10-10 10:05+07'),
    (1,   100000, 'transfer', 1, '2026-11-02 11:00+07'),   -- trả bớt nợ
    (2,   100000, 'cash',     1, '2026-11-02 10:31+07'),
    (3,   150000, 'cash',     1, '2026-11-02 10:36+07'),
    (4,   100000, 'cash',     1, '2026-03-15 09:41+07'),
    (5, 10000000, 'transfer', 1, '2026-10-20 10:41+07'),
    (7, 10000000, 'transfer', 1, '2026-10-14 10:05+07'),
    (7,  5000000, 'cash',     5, '2026-11-03 14:20+07'),
    (8,   500000, 'cash',     5, '2026-11-03 15:55+07');   -- trả thiếu, còn nợ

-- Chốt két (UC45): expected_cash do trigger tự cộng tiền mặt trong ngày
INSERT INTO cash_closing (closing_date, counted_cash, note, closed_by) VALUES
    ('2026-10-10', 300000, NULL, 1),
    ('2026-10-14',      0, NULL, 1),
    ('2026-11-02', 250000, NULL, 5);

COMMIT;
