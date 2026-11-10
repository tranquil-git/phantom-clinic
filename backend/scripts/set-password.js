// Đặt mật khẩu cho một nhân viên:  npm run set-password -- <username> <mật khẩu>
// Dùng khi mới nạp seed.sql (mật khẩu mẫu) hoặc khi quên mật khẩu quản lý.
import { hashPassword } from '../src/auth.js';
import { pool } from '../src/db.js';

const [username, password] = process.argv.slice(2);
if (!username || !password) {
  console.error('Cách dùng: npm run set-password -- <username> <mật khẩu>');
  process.exit(1);
}
const { rowCount } = await pool.query('UPDATE staff SET password_hash = $1 WHERE username = $2',
  [hashPassword(password), username]);
console.log(rowCount ? `Đã đặt mật khẩu cho ${username}` : `Không có nhân viên ${username}`);
await pool.end();
process.exit(rowCount ? 0 : 1);
