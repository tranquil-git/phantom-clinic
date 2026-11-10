// API phòng khám Nha khoa Nụ Cười Việt — chạy như server Node thường (máy dev, Render, Railway…).
// Trên Vercel không dùng file này: api/index.js xuất thẳng app làm serverless function.
import app from './app.js';
import { pool } from './db.js';

const isProduction = process.env.NODE_ENV === 'production';

// Host production tự cấp PORT và cần lắng nghe mọi địa chỉ; máy dev chỉ mở localhost
const port = Number(process.env.PORT ?? process.env.API_PORT ?? 4000);
const host = process.env.HOST ?? (isProduction ? '0.0.0.0' : '127.0.0.1');
const server = app.listen(port, host, () => {
  console.log(`API phòng khám (${isProduction ? 'production' : 'dev'}): http://${host}:${port}/api`);
});

// Host dừng / triển khai bản mới gửi SIGTERM → trả nốt request đang chạy, đóng kết nối DB rồi thoát
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    server.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
