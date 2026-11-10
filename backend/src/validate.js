import { HttpError } from './errors.js';

const bad = (label) => new HttpError(400, `${label} không hợp lệ`);
const blank = (v) => v === undefined || v === null || v === '';

export function text(v, label) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) throw new HttpError(400, `Thiếu ${label}`);
  return s;
}

export function optText(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  return s || null;
}

export function id(v, label) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw bad(label);
  return n;
}

export function optId(v, label) {
  return blank(v) ? null : id(v, label);
}

export function money(v, label, min = 0) {
  const n = Number(v);
  if (blank(v) || !Number.isInteger(n) || n < min) throw bad(label);
  return n;
}

export function quantity(v, label) {
  const n = Number(v);
  if (blank(v) || !Number.isFinite(n) || n <= 0) throw bad(label);
  return n;
}

export function date(v, label) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw bad(label);
  return v;
}

export function optDate(v, label) {
  return blank(v) ? null : date(v, label);
}

export function time(v, label) {
  if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d(:00)?$/.test(v)) throw bad(label);
  return v.slice(0, 5);
}

export function oneOf(v, values, label) {
  if (!values.includes(v)) throw bad(label);
  return v;
}

export function optOneOf(v, values, label) {
  return blank(v) ? null : oneOf(v, values, label);
}

export function month(v) {
  if (blank(v)) return todayLocal().slice(0, 7);
  if (typeof v !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) throw bad('Tháng');
  return v;
}

export function todayLocal() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
}

export function addDays(d, n) {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export function ageOn(dob, onDate = todayLocal()) {
  const [y, m, d] = dob.split('-').map(Number);
  const [Y, M, D] = onDate.split('-').map(Number);
  return Y - y - (M < m || (M === m && D < d) ? 1 : 0);
}
