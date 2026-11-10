// Prisma Client (Prisma 7, driver adapter pg) dùng chung pool với src/db.js:
// cùng SSL, cùng giới hạn kết nối, cùng "SET TIME ZONE 'Asia/Ho_Chi_Minh'" cho mỗi kết nối.
// Module xác thực & phân quyền đọc / ghi qua Prisma; các module nghiệp vụ còn lại dùng SQL (db.js).
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { pool } from './db.js';

export const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// Cột bigint (id) Prisma trả về BigInt, JSON không chuyển được → đổi sang Number (id < 2^53)
export const toId = (v) => (v == null ? v : Number(v));
