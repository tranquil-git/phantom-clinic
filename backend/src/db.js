import pg from 'pg';

pg.types.setTypeParser(1700, Number);             // numeric → số (tiền là numeric(12,0))
pg.types.setTypeParser(20, Number);               // bigint → số (id, count)
pg.types.setTypeParser(1082, (v) => v);           // date giữ nguyên 'YYYY-MM-DD', tránh lệch múi giờ
pg.types.setTypeParser(1083, (v) => v.slice(0, 5)); // time → 'HH:MM'

// Production (Neon…): DATABASE_URL. Máy dev: các biến CLINIC_DB_* trỏ vào Postgres Docker.
// Phiên DB chạy UTC (Prisma đọc / ghi timestamptz như thể phiên là UTC). Ngày giờ Việt Nam tính rõ ràng:
// local_date() / AT TIME ZONE 'Asia/Ho_Chi_Minh' trong SQL, todayLocal() trong JS.
const TIMEZONE = 'UTC';

function urlConfig(raw) {
  const url = new URL(raw);
  // Neon cho chuỗi "?sslmode=require&channel_binding=require". node-postgres coi require là verify-full
  // (vẫn kiểm chứng chỉ) nhưng in cảnh báo, và không đọc channel_binding → đổi sang tên nó hiểu.
  if (['require', 'prefer', 'verify-ca'].includes(url.searchParams.get('sslmode'))) {
    url.searchParams.set('sslmode', 'verify-full');
  }
  const channelBinding = url.searchParams.get('channel_binding') === 'require';
  url.searchParams.delete('channel_binding');
  return { connectionString: url.toString(), enableChannelBinding: channelBinding };
}

if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) {
  throw new Error('Thiếu DATABASE_URL (xem backend/.env.production.example)');
}

export const pool = new pg.Pool({
  ...(process.env.DATABASE_URL
    ? urlConfig(process.env.DATABASE_URL)
    : {
        host: process.env.CLINIC_DB_HOST ?? '127.0.0.1',
        port: Number(process.env.POSTGRES_PORT ?? 5433),
        database: process.env.CLINIC_DB_NAME,
        user: process.env.CLINIC_DB_USER,
        password: process.env.CLINIC_DB_PASSWORD,
      }),
  max: Number(process.env.DB_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,        // trả kết nối rảnh để Neon được tự ngủ (scale to zero)
  connectionTimeoutMillis: 25_000,  // lần đầu sau khi ngủ (Neon + Vercel) đo được ~15 giây; function Vercel cho tối đa 30 giây
});

// Database cũng đặt mặc định UTC (db/migrations/002); SET ở đây giữ đúng cả khi chạy trên database chưa migrate
pool.on('connect', (client) => {
  client.query(`SET TIME ZONE '${TIMEZONE}'`).catch(() => {});
});
// Kết nối rảnh bị DB cắt (Neon ngủ, mạng chập) → bỏ kết nối đó, không làm sập API
pool.on('error', (err) => console.error('Kết nối DB rảnh bị đóng:', err.message));

export async function query(text, params) {
  const { rows } = await pool.query(text, params);
  return rows;
}

export async function queryOne(text, params) {
  const rows = await query(text, params);
  return rows[0] ?? null;
}

// Mọi lệnh ghi chạy trong transaction có app.staff_id, để trigger audit / kho biết ai làm (LN-13)
export async function tx(staffId, fn, reason = '') {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.staff_id', $1, true), set_config('app.change_reason', $2, true)",
      [String(staffId), reason ?? ''],
    );
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
