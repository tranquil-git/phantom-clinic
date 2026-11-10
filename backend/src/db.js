import pg from 'pg';

pg.types.setTypeParser(1700, Number);             // numeric → số (tiền là numeric(12,0))
pg.types.setTypeParser(20, Number);               // bigint → số (id, count)
pg.types.setTypeParser(1082, (v) => v);           // date giữ nguyên 'YYYY-MM-DD', tránh lệch múi giờ
pg.types.setTypeParser(1083, (v) => v.slice(0, 5)); // time → 'HH:MM'

export const pool = new pg.Pool({
  host: process.env.CLINIC_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.POSTGRES_PORT ?? 5433),
  database: process.env.CLINIC_DB_NAME,
  user: process.env.CLINIC_DB_USER,
  password: process.env.CLINIC_DB_PASSWORD,
  max: 10,
});

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
