-- =====================================================================
-- TranquilClinicDB — CSDL Phòng khám Nha khoa Nụ Cười Việt (PostgreSQL 18)
-- Thiết kế: .claude/docs/erd.md   ·   Use case: .claude/docs/use-case.md
--
-- Tạo database + user: db/create-database.ps1 (chạy schema này bằng user TranAdmin).
--
-- Mọi lệnh ghi vào phiếu điều trị, liệu trình, kho phải chạy trong transaction có
--   SET LOCAL app.staff_id = '<id nhân viên>';
--   SET LOCAL app.change_reason = '<lý do sửa>';   -- không bắt buộc
-- để biết ai sửa, lúc nào (LN-13).
-- Tiền: VND, numeric(12,0). Giờ phòng khám: Asia/Ho_Chi_Minh.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Kiểu liệt kê
-- ---------------------------------------------------------------------
CREATE TYPE staff_role          AS ENUM ('receptionist', 'dentist', 'manager');
CREATE TYPE appointment_status  AS ENUM ('booked', 'checked_in', 'no_show', 'cancelled');
CREATE TYPE reminder_channel    AS ENUM ('call', 'sms');
CREATE TYPE reminder_result     AS ENUM ('confirmed', 'wants_reschedule', 'wants_cancel',
                                         'no_answer', 'sms_sent', 'sms_failed');
CREATE TYPE service_kind        AS ENUM ('single', 'plan');
CREATE TYPE plan_status         AS ENUM ('active', 'completed', 'cancelled');
CREATE TYPE item_kind           AS ENUM ('medicine', 'supply');
CREATE TYPE stock_movement_type AS ENUM ('receipt', 'treatment', 'dispense', 'manual_out', 'adjustment');
CREATE TYPE invoice_kind        AS ENUM ('visit', 'installment');
CREATE TYPE payment_method      AS ENUM ('cash', 'transfer');

-- ---------------------------------------------------------------------
-- Hàm tiện ích
-- ---------------------------------------------------------------------

-- Ngày theo giờ phòng khám
CREATE FUNCTION local_date(ts timestamptz) RETURNS date
LANGUAGE sql IMMUTABLE AS $$
    SELECT (ts AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
$$;

-- Khung 30 phút hợp lệ: 8h–20h, Chủ nhật 8h–17h (GT-02)
CREATE FUNCTION is_valid_slot(d date, t time) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
    SELECT extract(second FROM t) = 0
       AND extract(minute FROM t) IN (0, 30)
       AND t >= time '08:00'
       AND t <= CASE WHEN extract(isodow FROM d) = 7 THEN time '16:30' ELSE time '19:30' END
$$;

-- Mọi khung giờ mở cửa trong khoảng ngày [p_from, p_to]
CREATE FUNCTION clinic_slots(p_from date, p_to date)
RETURNS TABLE (slot_date date, slot_time time)
LANGUAGE sql STABLE AS $$
    SELECT d::date, t::time
    FROM generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') AS d
    CROSS JOIN generate_series(timestamp '2000-01-01 08:00', timestamp '2000-01-01 19:30',
                               interval '30 minutes') AS t
    WHERE is_valid_slot(d::date, t::time)
$$;

-- Nhân viên đang thao tác, do ứng dụng đặt bằng SET LOCAL app.staff_id
CREATE FUNCTION current_staff_id() RETURNS bigint
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v text := current_setting('app.staff_id', true);
BEGIN
    IF v IS NULL OR v = '' THEN
        RAISE EXCEPTION 'Chưa đặt app.staff_id — chạy SET LOCAL app.staff_id = ''<id nhân viên>'' trước khi ghi';
    END IF;
    RETURN v::bigint;
END
$$;

-- ---------------------------------------------------------------------
-- Nhân sự, ghế, ca trực
-- ---------------------------------------------------------------------
CREATE TABLE staff (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    full_name     text        NOT NULL,
    phone         text,
    role          staff_role  NOT NULL,
    username      text        NOT NULL UNIQUE,
    password_hash text        NOT NULL,
    is_active     boolean     NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, role)                      -- để bảng khác ép "phải là bác sĩ"
);
COMMENT ON TABLE staff IS 'Nhân viên: lễ tân, bác sĩ, quản lý';

CREATE TABLE chair (
    id        smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name      text    NOT NULL UNIQUE,     -- Ghế 1, Ghế 2, Ghế 3
    is_active boolean NOT NULL DEFAULT true
);
COMMENT ON TABLE chair IS 'Ghế máy';

CREATE TABLE doctor_shift (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    doctor_id   bigint     NOT NULL,
    doctor_role staff_role NOT NULL DEFAULT 'dentist' CHECK (doctor_role = 'dentist'),
    shift_date  date       NOT NULL,
    start_time  time       NOT NULL,
    end_time    time       NOT NULL,
    created_by  bigint     NOT NULL REFERENCES staff (id),
    FOREIGN KEY (doctor_id, doctor_role) REFERENCES staff (id, role),
    UNIQUE (doctor_id, shift_date),
    CHECK (start_time < end_time)
);
COMMENT ON TABLE doctor_shift IS 'Ca trực bác sĩ theo ngày (LN-11)';

-- ---------------------------------------------------------------------
-- Danh mục: dịch vụ, bảng giá, lý do hủy, thuốc & vật tư
-- ---------------------------------------------------------------------
CREATE TABLE service (
    id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code      text         NOT NULL UNIQUE,
    name      text         NOT NULL,
    kind      service_kind NOT NULL DEFAULT 'single',   -- plan = loại liệu trình (niềng, implant)
    is_active boolean      NOT NULL DEFAULT true,
    UNIQUE (id, kind)
);
COMMENT ON TABLE service IS 'Danh mục dịch vụ và loại liệu trình';

CREATE TABLE service_price (
    service_id     bigint        NOT NULL REFERENCES service (id),
    effective_from date          NOT NULL,
    price          numeric(12,0) NOT NULL CHECK (price >= 0),
    created_by     bigint        NOT NULL REFERENCES staff (id),
    created_at     timestamptz   NOT NULL DEFAULT now(),
    PRIMARY KEY (service_id, effective_from)
);
COMMENT ON TABLE service_price IS 'Bảng giá có ngày hiệu lực; giá cũ giữ lại (LN-05)';

CREATE FUNCTION service_price_at(p_service_id bigint, p_date date) RETURNS numeric
LANGUAGE sql STABLE AS $$
    SELECT price FROM service_price
    WHERE service_id = p_service_id AND effective_from <= p_date
    ORDER BY effective_from DESC
    LIMIT 1
$$;

CREATE TABLE cancel_reason (
    id        smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name      text    NOT NULL UNIQUE,
    is_active boolean NOT NULL DEFAULT true
);
COMMENT ON TABLE cancel_reason IS 'Danh mục lý do hủy lịch (dùng cho Q4)';

CREATE TABLE inventory_item (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind              item_kind     NOT NULL,
    name              text          NOT NULL,
    unit              text          NOT NULL,
    reorder_threshold numeric(12,2) NOT NULL DEFAULT 0 CHECK (reorder_threshold >= 0),
    sale_price        numeric(12,0) CHECK (sale_price >= 0),   -- giá bán thuốc cấp tại chỗ
    is_active         boolean       NOT NULL DEFAULT true,
    UNIQUE (kind, name),
    UNIQUE (id, kind),
    CHECK (kind = 'medicine' OR sale_price IS NULL)
);
COMMENT ON TABLE inventory_item IS 'Thuốc và vật tư trong kho';

CREATE TABLE service_supply (
    service_id bigint        NOT NULL REFERENCES service (id),
    item_id    bigint        NOT NULL,
    item_kind  item_kind     NOT NULL DEFAULT 'supply' CHECK (item_kind = 'supply'),
    quantity   numeric(12,2) NOT NULL CHECK (quantity > 0),
    PRIMARY KEY (service_id, item_id),
    FOREIGN KEY (item_id, item_kind) REFERENCES inventory_item (id, kind)
);
COMMENT ON TABLE service_supply IS 'Định mức vật tư cho một lần làm dịch vụ (GT-08)';

-- ---------------------------------------------------------------------
-- Bệnh nhân
-- ---------------------------------------------------------------------
CREATE TABLE patient (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,   -- mã bệnh nhân
    full_name         text        NOT NULL,
    date_of_birth     date,
    gender            text        CHECK (gender IN ('male', 'female', 'other')),
    contact_phone     text        NOT NULL CHECK (contact_phone ~ '^0[0-9]{9,10}$'),
    guardian_name     text,                  -- trẻ dưới 15 tuổi (mục 3.2)
    guardian_relation text,
    paper_record_no   text,                  -- số hồ sơ giấy cũ (GT-15)
    address           text,
    medical_note      text,                  -- tiền sử, dị ứng
    is_active         boolean     NOT NULL DEFAULT true,
    created_by        bigint      NOT NULL REFERENCES staff (id),
    created_at        timestamptz NOT NULL DEFAULT now(),
    CHECK ((guardian_name IS NULL) = (guardian_relation IS NULL))
);
COMMENT ON TABLE patient IS 'Hồ sơ bệnh nhân; SĐT liên hệ KHÔNG duy nhất (LN-01, mục 3.2)';
CREATE INDEX patient_contact_phone_idx ON patient (contact_phone);

-- ---------------------------------------------------------------------
-- Lịch hẹn
-- ---------------------------------------------------------------------
CREATE TABLE appointment (
    id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    patient_id         bigint             NOT NULL REFERENCES patient (id),
    doctor_id          bigint             NOT NULL REFERENCES staff (id),
    chair_id           smallint           NOT NULL REFERENCES chair (id),
    appt_date          date               NOT NULL,
    slot_time          time               NOT NULL,
    planned_service_id bigint             NOT NULL REFERENCES service (id),   -- việc cần làm
    status             appointment_status NOT NULL DEFAULT 'booked',
    note               text,
    booked_by          bigint             NOT NULL REFERENCES staff (id),
    booked_at          timestamptz        NOT NULL DEFAULT now(),
    checked_in_at      timestamptz,
    cancel_reason_id   smallint           REFERENCES cancel_reason (id),
    cancel_note        text,
    cancelled_by       bigint             REFERENCES staff (id),
    cancelled_at       timestamptz,
    CHECK (is_valid_slot(appt_date, slot_time)),                           -- LN-02
    CHECK ((status = 'cancelled'
            AND cancel_reason_id IS NOT NULL AND cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL)
        OR (status <> 'cancelled'
            AND cancel_reason_id IS NULL AND cancelled_by IS NULL AND cancelled_at IS NULL)),   -- LN-10
    CHECK ((status = 'checked_in') = (checked_in_at IS NOT NULL))
);
COMMENT ON TABLE appointment IS 'Lịch hẹn: đúng 1 bác sĩ, 1 ghế, 1 khung 30 phút (LN-02)';

-- LN-03: cùng bác sĩ / cùng ghế không có hai lịch trùng giờ (lịch đã hủy không tính)
CREATE UNIQUE INDEX appointment_doctor_slot_uq ON appointment (doctor_id, appt_date, slot_time)
    WHERE status <> 'cancelled';
CREATE UNIQUE INDEX appointment_chair_slot_uq ON appointment (chair_id, appt_date, slot_time)
    WHERE status <> 'cancelled';
CREATE INDEX appointment_patient_idx ON appointment (patient_id);
CREATE INDEX appointment_date_idx ON appointment (appt_date);

-- LN-11: chỉ xếp lịch vào ca bác sĩ đó trực
CREATE FUNCTION check_appointment_in_shift() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status <> 'cancelled' AND NOT EXISTS (
        SELECT 1 FROM doctor_shift s
        WHERE s.doctor_id = NEW.doctor_id
          AND s.shift_date = NEW.appt_date
          AND NEW.slot_time >= s.start_time
          AND NEW.slot_time + interval '30 minutes' <= s.end_time
    ) THEN
        RAISE EXCEPTION 'Bác sĩ % không có ca trực lúc % %', NEW.doctor_id, NEW.appt_date, NEW.slot_time;
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER appointment_in_shift
    BEFORE INSERT OR UPDATE OF doctor_id, appt_date, slot_time ON appointment
    FOR EACH ROW EXECUTE FUNCTION check_appointment_in_shift();

CREATE TABLE appointment_reminder (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    appointment_id bigint           NOT NULL REFERENCES appointment (id),
    channel        reminder_channel NOT NULL,
    result         reminder_result  NOT NULL,
    note           text,
    created_by     bigint           NOT NULL REFERENCES staff (id),
    created_at     timestamptz      NOT NULL DEFAULT now(),
    CHECK ((channel = 'sms') = (result IN ('sms_sent', 'sms_failed')))
);
COMMENT ON TABLE appointment_reminder IS 'Nhật ký gọi nhắc / gửi SMS (UC25, UC26)';

-- ---------------------------------------------------------------------
-- Điều trị: phiếu, liệu trình, dòng việc, đơn thuốc
-- ---------------------------------------------------------------------
CREATE TABLE treatment_record (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    appointment_id bigint      NOT NULL UNIQUE REFERENCES appointment (id),   -- ngày, giờ, ghế, bác sĩ chính
    diagnosis      text,
    note           text,
    created_by     bigint      NOT NULL REFERENCES staff (id),
    created_at     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE treatment_record IS 'Phiếu điều trị — một lượt khám';

CREATE TABLE treatment_plan (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    patient_id       bigint        NOT NULL REFERENCES patient (id),
    service_id       bigint        NOT NULL,
    service_kind     service_kind  NOT NULL DEFAULT 'plan' CHECK (service_kind = 'plan'),
    doctor_id        bigint        NOT NULL REFERENCES staff (id),   -- bác sĩ phụ trách
    total_price      numeric(12,0) NOT NULL CHECK (total_price >= 0),
    planned_sessions integer       NOT NULL CHECK (planned_sessions > 0),
    status           plan_status   NOT NULL DEFAULT 'active',
    started_on       date          NOT NULL DEFAULT local_date(now()),
    closed_on        date,
    note             text,
    created_by       bigint        NOT NULL REFERENCES staff (id),
    created_at       timestamptz   NOT NULL DEFAULT now(),
    FOREIGN KEY (service_id, service_kind) REFERENCES service (id, kind),
    CHECK ((status = 'active') = (closed_on IS NULL))
);
COMMENT ON TABLE treatment_plan IS 'Liệu trình nhiều buổi, giá chốt lúc tạo (LN-06, GT-09)';

CREATE TABLE plan_installment (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    plan_id        bigint        NOT NULL REFERENCES treatment_plan (id),
    installment_no integer       NOT NULL CHECK (installment_no > 0),
    amount         numeric(12,0) NOT NULL CHECK (amount > 0),
    due_date       date          NOT NULL,
    UNIQUE (plan_id, installment_no)
);
COMMENT ON TABLE plan_installment IS 'Kế hoạch các đợt trả tiền của liệu trình';

CREATE TABLE treatment_line (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    record_id  bigint  NOT NULL REFERENCES treatment_record (id),
    service_id bigint  NOT NULL REFERENCES service (id),
    -- LN-04, GT-05: FDI 11–48, 51–85; 00 cả miệng, 01 hàm trên, 02 hàm dưới
    tooth_code char(2) NOT NULL CHECK (tooth_code ~ '^(0[0-2]|[1-4][1-8]|[5-8][1-5])$'),
    doctor_id  bigint  NOT NULL REFERENCES staff (id),          -- bác sĩ thực hiện (mục 3.1)
    plan_id    bigint  REFERENCES treatment_plan (id),
    session_no integer CHECK (session_no > 0),                  -- buổi thứ mấy của liệu trình
    note       text,
    CHECK ((plan_id IS NULL) = (session_no IS NULL))
);
COMMENT ON TABLE treatment_line IS 'Mỗi việc đã làm trong lượt khám';
CREATE INDEX treatment_line_record_idx ON treatment_line (record_id);
CREATE INDEX treatment_line_plan_idx ON treatment_line (plan_id) WHERE plan_id IS NOT NULL;

CREATE TABLE prescription_item (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    record_id           bigint        NOT NULL REFERENCES treatment_record (id),
    item_id             bigint        NOT NULL,
    item_kind           item_kind     NOT NULL DEFAULT 'medicine' CHECK (item_kind = 'medicine'),
    dosage              text          NOT NULL,
    quantity            numeric(12,2) NOT NULL CHECK (quantity > 0),
    dispensed_in_clinic boolean       NOT NULL DEFAULT false,   -- true: cấp tại chỗ, trừ kho, tính tiền (GT-07)
    FOREIGN KEY (item_id, item_kind) REFERENCES inventory_item (id, kind)
);
COMMENT ON TABLE prescription_item IS 'Đơn thuốc theo từng lần khám (LN-07)';
CREATE INDEX prescription_item_record_idx ON prescription_item (record_id);

-- ---------------------------------------------------------------------
-- Kho: tồn = tổng các lần nhập / xuất
-- ---------------------------------------------------------------------
CREATE TABLE stock_movement (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    item_id       bigint              NOT NULL REFERENCES inventory_item (id),
    movement_type stock_movement_type NOT NULL,
    quantity      numeric(12,2)       NOT NULL CHECK (quantity <> 0),   -- dương: nhập, âm: xuất
    record_id     bigint              REFERENCES treatment_record (id),
    note          text,
    created_by    bigint              NOT NULL DEFAULT current_staff_id() REFERENCES staff (id),
    created_at    timestamptz         NOT NULL DEFAULT now(),
    CHECK ((movement_type IN ('treatment', 'dispense')) = (record_id IS NOT NULL)),
    CHECK (movement_type <> 'receipt'    OR quantity > 0),
    CHECK (movement_type <> 'manual_out' OR quantity < 0)
);
COMMENT ON TABLE stock_movement IS 'Nhập / xuất kho; treatment & dispense do trigger tự ghi (LN-14)';
CREATE INDEX stock_movement_item_idx ON stock_movement (item_id);

-- p_sign = 1: dùng vật tư; -1: hoàn lại khi sửa / xóa dòng
CREATE FUNCTION apply_service_supplies(p_record_id bigint, p_service_id bigint, p_sign integer)
RETURNS void
LANGUAGE sql AS $$
    INSERT INTO stock_movement (item_id, movement_type, quantity, record_id, note)
    SELECT ss.item_id, 'treatment', -p_sign * ss.quantity, p_record_id,
           CASE WHEN p_sign > 0 THEN 'Dùng theo định mức' ELSE 'Hoàn kho do sửa phiếu' END
    FROM service_supply ss
    WHERE ss.service_id = p_service_id
$$;

CREATE FUNCTION treatment_line_stock() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        PERFORM apply_service_supplies(OLD.record_id, OLD.service_id, -1);
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        PERFORM apply_service_supplies(NEW.record_id, NEW.service_id, 1);
    END IF;
    RETURN NULL;
END
$$;
CREATE TRIGGER treatment_line_stock
    AFTER INSERT OR DELETE OR UPDATE OF service_id ON treatment_line
    FOR EACH ROW EXECUTE FUNCTION treatment_line_stock();

CREATE FUNCTION prescription_stock() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.dispensed_in_clinic THEN
        INSERT INTO stock_movement (item_id, movement_type, quantity, record_id, note)
        VALUES (OLD.item_id, 'dispense', OLD.quantity, OLD.record_id, 'Hoàn kho do sửa đơn thuốc');
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.dispensed_in_clinic THEN
        INSERT INTO stock_movement (item_id, movement_type, quantity, record_id, note)
        VALUES (NEW.item_id, 'dispense', -NEW.quantity, NEW.record_id, 'Cấp thuốc');
    END IF;
    RETURN NULL;
END
$$;
CREATE TRIGGER prescription_stock
    AFTER INSERT OR DELETE OR UPDATE OF item_id, quantity, dispensed_in_clinic ON prescription_item
    FOR EACH ROW EXECUTE FUNCTION prescription_stock();

-- ---------------------------------------------------------------------
-- Hóa đơn, thu tiền, chốt két
-- ---------------------------------------------------------------------
CREATE TABLE invoice (
    id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind                  invoice_kind  NOT NULL,
    record_id             bigint        UNIQUE REFERENCES treatment_record (id),
    installment_id        bigint        UNIQUE REFERENCES plan_installment (id),
    -- Giảm ở tổng: chỉ để in đúng như khách thấy; số tiền đã được phân bổ xuống invoice_line (mục 3.3)
    total_discount_amount numeric(12,0) NOT NULL DEFAULT 0 CHECK (total_discount_amount >= 0),
    discount_reason       text,
    created_by            bigint        NOT NULL REFERENCES staff (id),
    created_at            timestamptz   NOT NULL DEFAULT now(),
    CHECK ((kind = 'visit'       AND record_id IS NOT NULL AND installment_id IS NULL)
        OR (kind = 'installment' AND installment_id IS NOT NULL AND record_id IS NULL))
);
COMMENT ON TABLE invoice IS 'Hóa đơn lượt khám hoặc đợt liệu trình';

CREATE TABLE invoice_line (
    id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    invoice_id           bigint        NOT NULL REFERENCES invoice (id),
    treatment_line_id    bigint        UNIQUE REFERENCES treatment_line (id),
    prescription_item_id bigint        UNIQUE REFERENCES prescription_item (id),
    description          text          NOT NULL,
    quantity             numeric(12,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price           numeric(12,0) NOT NULL CHECK (unit_price >= 0),   -- giá lúc làm (LN-05)
    discount_amount      numeric(12,0) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    doctor_id            bigint        REFERENCES staff (id),   -- bác sĩ được tính doanh thu; NULL với thuốc
    amount               numeric(12,0) GENERATED ALWAYS AS (round(quantity * unit_price) - discount_amount) STORED,
    CHECK (num_nonnulls(treatment_line_id, prescription_item_id) <= 1),
    CHECK (discount_amount <= round(quantity * unit_price))
);
COMMENT ON TABLE invoice_line IS 'Dòng hóa đơn: giá và giảm giá chốt tại đây';
CREATE INDEX invoice_line_invoice_idx ON invoice_line (invoice_id);

CREATE TABLE payment (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    invoice_id  bigint         NOT NULL REFERENCES invoice (id),
    amount      numeric(12,0)  NOT NULL CHECK (amount > 0),
    method      payment_method NOT NULL,                       -- LN-08
    received_by bigint         NOT NULL REFERENCES staff (id),
    received_at timestamptz    NOT NULL DEFAULT now(),
    note        text
);
COMMENT ON TABLE payment IS 'Mỗi lần thu tiền của một hóa đơn (LN-08)';
CREATE INDEX payment_invoice_idx ON payment (invoice_id);

CREATE TABLE cash_closing (
    closing_date  date          PRIMARY KEY,
    expected_cash numeric(12,0) NOT NULL,   -- trigger tự tính từ payment tiền mặt
    counted_cash  numeric(12,0) NOT NULL CHECK (counted_cash >= 0),
    difference    numeric(12,0) GENERATED ALWAYS AS (counted_cash - expected_cash) STORED,
    note          text,
    closed_by     bigint        NOT NULL REFERENCES staff (id),
    closed_at     timestamptz   NOT NULL DEFAULT now(),
    CHECK (counted_cash = expected_cash OR note IS NOT NULL)
);
COMMENT ON TABLE cash_closing IS 'Chốt két cuối ngày (UC45)';

-- LN-09: còn nợ luôn = tổng dòng − tổng các lần thu
CREATE VIEW invoice_balance AS
SELECT i.id                          AS invoice_id,
       i.kind,
       i.created_at,
       COALESCE(a.patient_id, tp.patient_id) AS patient_id,
       t.total,
       p.paid,
       t.total - p.paid              AS remaining
FROM invoice i
LEFT JOIN treatment_record r  ON r.id  = i.record_id
LEFT JOIN appointment a       ON a.id  = r.appointment_id
LEFT JOIN plan_installment pi ON pi.id = i.installment_id
LEFT JOIN treatment_plan tp   ON tp.id = pi.plan_id
CROSS JOIN LATERAL (SELECT COALESCE(sum(l.amount), 0) AS total
                    FROM invoice_line l WHERE l.invoice_id = i.id) t
CROSS JOIN LATERAL (SELECT COALESCE(sum(pm.amount), 0) AS paid
                    FROM payment pm WHERE pm.invoice_id = i.id) p;

-- Không thu quá số còn nợ; không thu / sửa vào ngày đã chốt két
CREATE FUNCTION check_payment() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_total numeric;
    v_paid  numeric;
BEGIN
    IF EXISTS (SELECT 1 FROM cash_closing WHERE closing_date = local_date(NEW.received_at))
       OR (TG_OP = 'UPDATE'
           AND EXISTS (SELECT 1 FROM cash_closing WHERE closing_date = local_date(OLD.received_at))) THEN
        RAISE EXCEPTION 'Ngày % đã chốt két, không thu hoặc sửa khoản thu', local_date(NEW.received_at);
    END IF;

    PERFORM 1 FROM invoice WHERE id = NEW.invoice_id FOR UPDATE;   -- tránh hai lễ tân thu cùng lúc
    SELECT COALESCE(sum(amount), 0) INTO v_total FROM invoice_line WHERE invoice_id = NEW.invoice_id;
    SELECT COALESCE(sum(amount), 0) INTO v_paid  FROM payment
    WHERE invoice_id = NEW.invoice_id AND id <> NEW.id;

    IF v_paid + NEW.amount > v_total THEN
        RAISE EXCEPTION 'Thu % vượt số còn nợ % của hóa đơn %', NEW.amount, v_total - v_paid, NEW.invoice_id;
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER payment_check
    BEFORE INSERT OR UPDATE ON payment
    FOR EACH ROW EXECUTE FUNCTION check_payment();

CREATE FUNCTION fill_expected_cash() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    SELECT COALESCE(sum(amount), 0) INTO NEW.expected_cash
    FROM payment
    WHERE method = 'cash' AND local_date(received_at) = NEW.closing_date;
    RETURN NEW;
END
$$;
CREATE TRIGGER cash_closing_expected
    BEFORE INSERT OR UPDATE ON cash_closing
    FOR EACH ROW EXECUTE FUNCTION fill_expected_cash();

-- GT-11: hóa đơn đã có lần thu thì dòng hóa đơn và dịch vụ trên phiếu bị khóa
CREATE FUNCTION lock_paid_invoice_line() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_invoice_id bigint := CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
BEGIN
    IF EXISTS (SELECT 1 FROM payment WHERE invoice_id = v_invoice_id)
       OR (TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM payment WHERE invoice_id = OLD.invoice_id)) THEN
        RAISE EXCEPTION 'Hóa đơn % đã có lần thu, không sửa được dòng', v_invoice_id;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER invoice_line_lock
    BEFORE INSERT OR UPDATE OR DELETE ON invoice_line
    FOR EACH ROW EXECUTE FUNCTION lock_paid_invoice_line();

CREATE FUNCTION lock_paid_treatment_line() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM invoice_line il JOIN payment p ON p.invoice_id = il.invoice_id
               WHERE il.treatment_line_id = OLD.id) THEN
        RAISE EXCEPTION 'Dòng việc % đã nằm trong hóa đơn có lần thu, không đổi dịch vụ / xóa được', OLD.id;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER treatment_line_lock
    BEFORE DELETE OR UPDATE OF service_id ON treatment_line
    FOR EACH ROW EXECUTE FUNCTION lock_paid_treatment_line();

-- ---------------------------------------------------------------------
-- LN-13: lịch sử sửa phiếu điều trị và liệu trình
-- ---------------------------------------------------------------------
CREATE TABLE audit_log (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    table_name text        NOT NULL,
    row_id     bigint      NOT NULL,
    record_id  bigint,                 -- phiếu điều trị liên quan, để xem lịch sử theo phiếu (UC36)
    action     text        NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
    old_data   jsonb,
    new_data   jsonb,
    reason     text,
    changed_by bigint      NOT NULL REFERENCES staff (id),
    changed_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE audit_log IS 'Ai sửa, lúc nào, giá trị cũ → mới (LN-13)';
CREATE INDEX audit_log_record_idx ON audit_log (record_id);
CREATE INDEX audit_log_row_idx ON audit_log (table_name, row_id);

CREATE FUNCTION audit_row() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    r jsonb := COALESCE(to_jsonb(NEW), to_jsonb(OLD));
BEGIN
    INSERT INTO audit_log (table_name, row_id, record_id, action, old_data, new_data, reason, changed_by)
    VALUES (TG_TABLE_NAME,
            (r ->> 'id')::bigint,
            CASE WHEN TG_TABLE_NAME = 'treatment_record' THEN (r ->> 'id')::bigint
                 ELSE (r ->> 'record_id')::bigint END,
            TG_OP,
            CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
            CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END,
            NULLIF(current_setting('app.change_reason', true), ''),
            current_staff_id());
    RETURN NULL;
END
$$;
CREATE TRIGGER treatment_record_audit AFTER UPDATE ON treatment_record
    FOR EACH ROW EXECUTE FUNCTION audit_row();
CREATE TRIGGER treatment_line_audit AFTER INSERT OR UPDATE OR DELETE ON treatment_line
    FOR EACH ROW EXECUTE FUNCTION audit_row();
CREATE TRIGGER prescription_item_audit AFTER INSERT OR UPDATE OR DELETE ON prescription_item
    FOR EACH ROW EXECUTE FUNCTION audit_row();
CREATE TRIGGER treatment_plan_audit AFTER UPDATE ON treatment_plan
    FOR EACH ROW EXECUTE FUNCTION audit_row();

-- ---------------------------------------------------------------------
-- LN-12: giữ hồ sơ 5 năm — không xóa, chỉ ngừng hoạt động
-- ---------------------------------------------------------------------
CREATE FUNCTION forbid_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Không được xóa dữ liệu bảng % (giữ hồ sơ 5 năm — LN-12)', TG_TABLE_NAME;
END
$$;
CREATE TRIGGER patient_no_delete          BEFORE DELETE ON patient          FOR EACH ROW EXECUTE FUNCTION forbid_delete();
CREATE TRIGGER appointment_no_delete      BEFORE DELETE ON appointment      FOR EACH ROW EXECUTE FUNCTION forbid_delete();
CREATE TRIGGER treatment_record_no_delete BEFORE DELETE ON treatment_record FOR EACH ROW EXECUTE FUNCTION forbid_delete();
CREATE TRIGGER treatment_plan_no_delete   BEFORE DELETE ON treatment_plan   FOR EACH ROW EXECUTE FUNCTION forbid_delete();
CREATE TRIGGER invoice_no_delete          BEFORE DELETE ON invoice          FOR EACH ROW EXECUTE FUNCTION forbid_delete();
CREATE TRIGGER payment_no_delete          BEFORE DELETE ON payment          FOR EACH ROW EXECUTE FUNCTION forbid_delete();

-- ---------------------------------------------------------------------
-- View dùng cho báo cáo
-- ---------------------------------------------------------------------
CREATE VIEW inventory_stock AS
SELECT i.id                         AS item_id,
       i.kind,
       i.name,
       i.unit,
       i.reorder_threshold,
       COALESCE(sum(m.quantity), 0) AS on_hand,
       COALESCE(sum(m.quantity), 0) <= i.reorder_threshold AS below_threshold
FROM inventory_item i
LEFT JOIN stock_movement m ON m.item_id = i.id
WHERE i.is_active
GROUP BY i.id;

CREATE VIEW plan_progress AS
SELECT tp.id                                            AS plan_id,
       tp.patient_id,
       tp.service_id,
       tp.doctor_id,
       tp.status,
       tp.planned_sessions,
       s.sessions_done,
       GREATEST(tp.planned_sessions - s.sessions_done, 0) AS sessions_left,
       tp.total_price,
       pd.paid
FROM treatment_plan tp
CROSS JOIN LATERAL (SELECT count(DISTINCT tl.record_id) AS sessions_done
                    FROM treatment_line tl WHERE tl.plan_id = tp.id) s
CROSS JOIN LATERAL (SELECT COALESCE(sum(pm.amount), 0) AS paid
                    FROM plan_installment pi
                    JOIN invoice i  ON i.installment_id = pi.id
                    JOIN payment pm ON pm.invoice_id = i.id
                    WHERE pi.plan_id = tp.id) pd;

COMMIT;
