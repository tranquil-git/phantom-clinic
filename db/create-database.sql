-- Tạo user quản trị + database phòng khám. Chạy bằng superuser (POSTGRES_USER) trên database bất kỳ.
-- Biến psql: :db_name, :db_user, :db_password — do db/create-database.ps1 truyền vào từ .env.
-- Chạy lại được: user / database đã có thì bỏ qua (mật khẩu vẫn được đặt lại theo .env).

SELECT format('CREATE ROLE %I LOGIN', :'db_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'db_user') \gexec

SELECT format('ALTER ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L', :'db_user', :'db_password') \gexec

SELECT format('CREATE DATABASE %I OWNER %I ENCODING ''UTF8'' TEMPLATE template0', :'db_name', :'db_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db_name') \gexec

-- Chỉ chủ database (và superuser) được kết nối; giờ mặc định theo phòng khám
SELECT format('REVOKE CONNECT, TEMPORARY ON DATABASE %I FROM PUBLIC', :'db_name') \gexec
SELECT format('ALTER DATABASE %I SET timezone TO ''Asia/Ho_Chi_Minh''', :'db_name') \gexec
