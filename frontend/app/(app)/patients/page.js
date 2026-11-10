'use client';

// UC10 Tra cứu bệnh nhân theo SĐT / tên — một SĐT có thể là cả nhà
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { EmptyRow, Loading, PageHeader } from '@/components/ui';
import { qs } from '@/lib/api';
import { ROLE, age, fmtDate, vnd } from '@/lib/format';
import { useApi, useUser } from '@/lib/hooks';

export default function PatientsPage() {
  const user = useUser();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const list = useApi(`/patients${qs({ q: term })}`);

  return (
    <>
      <PageHeader title="Bệnh nhân" subtitle="Tìm theo số điện thoại hoặc tên. Trẻ dưới 15 tuổi dùng SĐT của người giám hộ.">
        {user.role === ROLE.receptionist && <Link className="btn btn-primary" href="/patients/new">+ Hồ sơ mới</Link>}
      </PageHeader>
      <div className="card">
        <input autoFocus placeholder="SĐT hoặc tên…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Loading state={list} />
      <div className="card card-tight">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Mã</th><th>Họ tên</th><th>Ngày sinh</th><th>SĐT liên hệ</th><th>Người giám hộ</th><th>Khám gần nhất</th><th className="num">Còn nợ</th></tr></thead>
            <tbody>
              {list.data?.length === 0 && <EmptyRow cols={7}>Không tìm thấy bệnh nhân</EmptyRow>}
              {list.data?.map((p) => (
                <tr key={p.id}>
                  <td className="muted">#{p.id}</td>
                  <td><Link href={`/patients/${p.id}`}><strong>{p.full_name}</strong></Link>{!p.is_active && <span className="badge" style={{ marginLeft: 6 }}>Ngừng</span>}</td>
                  <td>{p.date_of_birth ? `${fmtDate(p.date_of_birth)} (${age(p.date_of_birth)})` : '—'}</td>
                  <td>{p.contact_phone}</td>
                  <td>{p.guardian_name ? `${p.guardian_name} (${p.guardian_relation})` : '—'}</td>
                  <td>{fmtDate(p.last_visit)}</td>
                  <td className="num">{p.debt > 0 ? <span className="badge badge-warn">{vnd(p.debt)}</span> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
