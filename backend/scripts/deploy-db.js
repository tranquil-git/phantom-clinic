// Nạp db/schema.sql + db/seed.sql lên database production (Neon…), rồi chạy db/migrations chưa chạy:  npm run db:deploy
// Đọc DATABASE_URL trong backend/.env.production. Database đã có dữ liệu thì không nạp lại schema / seed.
// Thêm --schema-only để chỉ tạo bảng, không nạp dữ liệu mẫu.
import fs from 'node:fs';
import { pool } from '../src/db.js';
import { runMigrations } from './migrate.js';

const files = process.argv.includes('--schema-only') ? ['schema.sql'] : ['schema.sql', 'seed.sql'];
const sql = (file) => fs.readFileSync(new URL(`../../db/${file}`, import.meta.url), 'utf8');

const client = await pool.connect();
try {
  const { rows: [db] } = await client.query(`
    SELECT current_database() AS name, current_user AS usr, current_setting('server_version') AS version,
           to_regclass('public.staff') IS NOT NULL AS has_schema`);
  console.log(`Database ${db.name} · user ${db.usr} · PostgreSQL ${db.version}`);

  // Mọi phiên mới của database chạy UTC (Prisma cần), giống db/create-database.sql (cần là chủ database)
  try {
    await client.query(`ALTER DATABASE ${client.escapeIdentifier(db.name)} SET timezone TO 'UTC'`);
  } catch (err) {
    console.warn(`! Không đặt được múi giờ mặc định của database (${err.message}). API vẫn tự đặt UTC mỗi kết nối.`);
  }

  let toRun = files;
  if (db.has_schema) {
    const { rows: [staff] } = await client.query('SELECT count(*) AS n FROM staff');
    toRun = staff.n === 0 ? files.filter((f) => f !== 'schema.sql') : [];
    console.log(toRun.length ? 'Đã có bảng, chưa có dữ liệu → chỉ nạp seed.' : 'Đã có bảng và dữ liệu → không ghi đè gì.');
  }
  for (const file of toRun) {
    process.stdout.write(`Chạy db/${file} ... `);
    await client.query(sql(file)); // mỗi file tự BEGIN/COMMIT → lỗi giữa chừng thì không để lại nửa vời
    console.log('xong');
  }
  await runMigrations(client);

  const { rows: tables } = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`);
  const counts = [];
  for (const { table_name: name } of tables) {
    const { rows: [r] } = await client.query(`SELECT count(*) AS n FROM ${client.escapeIdentifier(name)}`);
    counts.push({ bang: name, so_dong: r.n });
  }
  console.table(counts);
} finally {
  client.release();
  await pool.end();
}
