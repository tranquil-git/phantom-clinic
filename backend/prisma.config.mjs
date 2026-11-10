// Cấu hình Prisma CLI (Prisma 7). App không dùng file này: src/prisma.js nối Prisma vào pool pg sẵn có.
// Database là "database-first": cấu trúc nằm ở db/schema.sql + db/migrations (trigger, view, ràng buộc
// mà schema.prisma không diễn tả được), schema.prisma lấy từ database bằng: npm run db:pull
import { defineConfig } from 'prisma/config';

// Giống src/db.js: production dùng DATABASE_URL, máy dev ghép từ CLINIC_DB_* trong ../.env
function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const { CLINIC_DB_USER: user, CLINIC_DB_PASSWORD: password, CLINIC_DB_NAME: name } = process.env;
  if (!user || !name) return undefined; // prisma generate không cần kết nối
  const host = process.env.CLINIC_DB_HOST ?? '127.0.0.1';
  const port = process.env.POSTGRES_PORT ?? '5433';
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password ?? '')}@${host}:${port}/${encodeURIComponent(name)}`;
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: { url: databaseUrl() },
});
