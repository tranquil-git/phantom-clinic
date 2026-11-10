// Chạy các file db/migrations/*.sql chưa chạy, theo thứ tự tên; ghi lại vào bảng schema_migration.
//   npm run db:migrate        → database ở máy (../.env)
//   npm run db:migrate:prod   → database production (backend/.env.production)
// File migration không tự BEGIN/COMMIT: mỗi file + dòng ghi nhận chạy trong một transaction,
// lỗi giữa chừng thì không thay đổi gì, sửa file rồi chạy lại.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db.js';

const DIR = new URL('../../db/migrations/', import.meta.url);

export async function runMigrations(client, log = console.log) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
  const { rows } = await client.query('SELECT name FROM schema_migration');
  const done = new Set(rows.map((r) => r.name));
  const pending = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql') && !done.has(f)).sort();
  if (!pending.length) log('Migration: không có file mới.');
  for (const file of pending) {
    log(`Migration ${file} ...`);
    try {
      await client.query('BEGIN');
      await client.query(fs.readFileSync(new URL(file, DIR), 'utf8'));
      await client.query('INSERT INTO schema_migration (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${file} lỗi, không thay đổi gì: ${err.message}`);
    }
  }
  return pending;
}

// Chạy trực tiếp (npm run db:migrate), không chạy khi được import từ deploy-db.js
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const client = await pool.connect();
  try {
    await runMigrations(client);
  } finally {
    client.release();
    await pool.end();
  }
}
