// Dòng tính tiền của một phiếu điều trị: dịch vụ lẻ (không thuộc liệu trình) + thuốc cấp tại chỗ.
// Giá lấy theo ngày khám (GT-19), chép cố định vào invoice_line (LN-05).
import { HttpError } from './errors.js';

const TOOTH_LABEL = { '00': 'cả miệng', '01': 'hàm trên', '02': 'hàm dưới' };

export async function billableLines(client, recordId) {
  const { rows } = await client.query(`
    SELECT tl.id AS treatment_line_id, NULL::bigint AS prescription_item_id,
           sv.name AS name, tl.tooth_code, 1::numeric AS quantity,
           service_price_at(tl.service_id, a.appt_date) AS unit_price, tl.doctor_id
    FROM treatment_line tl
    JOIN treatment_record r ON r.id = tl.record_id
    JOIN appointment a ON a.id = r.appointment_id
    JOIN service sv ON sv.id = tl.service_id
    WHERE tl.record_id = $1 AND tl.plan_id IS NULL
    UNION ALL
    SELECT NULL, pi.id, it.name, NULL, pi.quantity, it.sale_price, NULL
    FROM prescription_item pi
    JOIN inventory_item it ON it.id = pi.item_id
    WHERE pi.record_id = $1 AND pi.dispensed_in_clinic
    ORDER BY 1 NULLS LAST, 2`, [recordId]);

  return rows.map((l) => {
    if (l.unit_price === null) {
      throw new HttpError(409, `"${l.name}" chưa có giá vào ngày khám — quản lý cần nhập bảng giá`);
    }
    const tooth = l.tooth_code ? ` — ${TOOTH_LABEL[l.tooth_code] ?? `răng ${l.tooth_code}`}` : '';
    return { ...l, description: `${l.name}${tooth}`, gross: Math.round(l.quantity * l.unit_price) };
  });
}

export async function invoiceOfRecord(client, recordId) {
  const { rows } = await client.query(`
    SELECT i.id, EXISTS (SELECT 1 FROM payment p WHERE p.invoice_id = i.id) AS has_payment
    FROM invoice i WHERE i.record_id = $1`, [recordId]);
  return rows[0] ?? null;
}

// Sửa phiếu khi hóa đơn chưa thu đồng nào → tính lại dòng, giữ giảm giá cũ của từng dòng (UC35)
export async function rebuildInvoice(client, recordId) {
  const invoice = await invoiceOfRecord(client, recordId);
  if (!invoice || invoice.has_payment) return;
  const { rows: old } = await client.query(
    'SELECT treatment_line_id, prescription_item_id, discount_amount FROM invoice_line WHERE invoice_id = $1',
    [invoice.id],
  );
  const oldDiscount = new Map(old.map((l) => [`${l.treatment_line_id}-${l.prescription_item_id}`, l.discount_amount]));
  await client.query('DELETE FROM invoice_line WHERE invoice_id = $1', [invoice.id]);
  for (const l of await billableLines(client, recordId)) {
    const discount = Math.min(oldDiscount.get(`${l.treatment_line_id}-${l.prescription_item_id}`) ?? 0, l.gross);
    await insertLine(client, invoice.id, l, discount);
  }
}

export async function insertLine(client, invoiceId, l, discount) {
  await client.query(`
    INSERT INTO invoice_line (invoice_id, treatment_line_id, prescription_item_id, description,
                              quantity, unit_price, discount_amount, doctor_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
  [invoiceId, l.treatment_line_id, l.prescription_item_id, l.description,
    l.quantity, l.unit_price, discount, l.doctor_id]);
}

// Không thêm / bớt dòng tính tiền khi hóa đơn đã có lần thu (GT-11)
export async function assertBillingOpen(client, recordId) {
  const invoice = await invoiceOfRecord(client, recordId);
  if (invoice?.has_payment) {
    throw new HttpError(409, 'Hóa đơn của phiếu này đã thu tiền — không thêm / bớt dòng tính tiền được nữa');
  }
}
