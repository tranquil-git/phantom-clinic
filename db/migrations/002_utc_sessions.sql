-- =====================================================================
-- 002 — Phiên database chạy múi giờ UTC (trước đây Asia/Ho_Chi_Minh)
-- Prisma (driver adapter pg) coi phiên là UTC: đọc timestamptz thì bỏ phần "+07", ghi thì gửi giờ không
-- kèm múi giờ → phiên giờ VN làm thời điểm lệch 7 tiếng (đổi mật khẩu, đếm lần đăng nhập sai…).
-- Nghiệp vụ không phụ thuộc múi giờ phiên: SQL đổi sang giờ VN rõ ràng bằng local_date() / AT TIME ZONE
-- 'Asia/Ho_Chi_Minh', JS dùng todayLocal(), dữ liệu mẫu ghi giờ kèm +07.
-- Không tự BEGIN/COMMIT: scripts/migrate.js bọc file trong một transaction.
-- =====================================================================
DO $$
BEGIN
    EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'UTC');
END $$;
