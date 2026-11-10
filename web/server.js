// Web app sản phẩm: trang danh sách + API JSON đọc bảng products, categories.
// Chạy: cd web && npm start   (đọc thông tin kết nối từ ../.env)

import { fileURLToPath } from 'node:url';
import express from 'express';
import pg from 'pg';

// numeric (OID 1700) trả về số thay vì chuỗi; price là numeric(12,0) nên không mất độ chính xác
pg.types.setTypeParser(1700, Number);

const pool = new pg.Pool({
  host: process.env.POSTGRES_HOST ?? '127.0.0.1',
  port: Number(process.env.POSTGRES_PORT ?? 5433),
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  max: 5,
});

const app = express();
app.use(express.static(fileURLToPath(new URL('./public', import.meta.url))));

app.get('/api/categories', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.id, c.name, c.description, count(p.id)::int AS product_count
      FROM categories c
      LEFT JOIN products p ON p.category_id = c.id
      GROUP BY c.id
      ORDER BY c.id`);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

app.get('/api/products', async (req, res, next) => {
  const { category } = req.query;
  if (category !== undefined && !/^\d+$/.test(category)) {
    return res.status(400).json({ error: 'category phải là số' });
  }
  try {
    const { rows } = await pool.query(`
      SELECT p.id, p.name, p.price, p.image, p.description,
             c.id AS category_id, c.name AS category_name
      FROM products p
      JOIN categories c ON c.id = p.category_id
      WHERE $1::bigint IS NULL OR p.category_id = $1
      ORDER BY c.id, p.price DESC`, [category ?? null]);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

app.get('/api/products/:id', async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) {
    return res.status(400).json({ error: 'id phải là số' });
  }
  try {
    const { rows } = await pool.query(`
      SELECT p.id, p.name, p.price, p.image, p.description,
             c.id AS category_id, c.name AS category_name
      FROM products p
      JOIN categories c ON c.id = p.category_id
      WHERE p.id = $1`, [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Lỗi máy chủ hoặc không kết nối được database' });
});

const port = Number(process.env.WEB_PORT ?? 3000);
app.listen(port, '127.0.0.1', () => {
  console.log(`Web app: http://127.0.0.1:${port}`);
});
