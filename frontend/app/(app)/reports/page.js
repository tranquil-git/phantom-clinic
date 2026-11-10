'use client';

// UC70 – UC79: tám câu quản lý hỏi hằng tháng + đối soát két
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { EmptyRow, Field, Loading, PageHeader } from '@/components/ui';
import { fmtDate, num, todayLocal, vnd } from '@/lib/format';
import { useApi } from '@/lib/hooks';

function cell(value, type) {
  if (value === null || value === undefined) return '—';
  if (type === 'money') return vnd(value);
  if (type === 'number') return num(value);
  if (type === 'date') return fmtDate(value);
  if (type === 'pct') return `${value > 0 ? '+' : ''}${num(value)}%`;
  return value;
}

function Bars({ rows, chart }) {
  const max = Math.max(1, ...rows.map((r) => r[chart.value]));
  return (
    <div className="card bars">
      {rows.map((r) => (
        <div key={r[chart.label]} className="bar-row">
          <span>{r[chart.label]}</span>
          <div className="bar-track"><div className="bar-fill" style={{ width: `${(r[chart.value] / max) * 100}%` }} /></div>
          <span className="right"><strong>{vnd(r[chart.value])}</strong></span>
        </div>
      ))}
    </div>
  );
}

// Ghế × khung giờ, đậm = trống nhiều
function Heatmap({ rows, heatmap }) {
  const chairs = [...new Set(rows.map((r) => r[heatmap.row]))].sort();
  const times = [...new Set(rows.map((r) => r[heatmap.col]))].sort();
  const max = Math.max(1, ...rows.map((r) => r[heatmap.value]));
  const get = (c, t) => rows.find((r) => r[heatmap.row] === c && r[heatmap.col] === t)?.[heatmap.value] ?? 0;
  return (
    <div className="card table-wrap">
      <p className="small muted" style={{ marginTop: 0 }}>Số lần trống của từng ghế theo khung giờ — ô càng đậm càng hay trống.</p>
      <table className="heat">
        <thead><tr><th />{times.map((t) => <th key={t}>{t}</th>)}</tr></thead>
        <tbody>
          {chairs.map((c) => (
            <tr key={c}>
              <th>{c}</th>
              {times.map((t) => {
                const v = get(c, t);
                return <td key={t} style={{ background: `color-mix(in srgb, var(--primary) ${Math.round((v / max) * 85)}%, transparent)` }} title={`${c} ${t}: trống ${v} lần`}>{v}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReportsInner() {
  const params = useSearchParams();
  const list = useApi('/reports');
  const [key, setKey] = useState(params.get('r') ?? 'revenue-by-doctor');
  const [month, setMonth] = useState(todayLocal().slice(0, 7));
  const report = useApi(`/reports/${key}?month=${month}`);
  const r = report.data;

  return (
    <>
      <PageHeader title="Báo cáo quản lý" subtitle="Tám câu hỏi hằng tháng — số liệu lấy trực tiếp từ hóa đơn, lịch hẹn, liệu trình và kho">
        <Field label="Tháng"><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>
      </PageHeader>
      <div className="tabs">
        {list.data?.map((x) => (
          <button key={x.key} type="button" className={`tab ${x.key === key ? 'active' : ''}`} onClick={() => setKey(x.key)} title={x.title}>
            {x.short}
          </button>
        ))}
      </div>
      <Loading state={report} />
      {r && r.key === key && (
        <>
          <h2>{r.title}</h2>
          {r.chart && r.rows.length > 0 && <Bars rows={r.rows} chart={r.chart} />}
          {r.heatmap && r.rows.length > 0 && <Heatmap rows={r.rows} heatmap={r.heatmap} />}
          <div className="card card-tight">
            <div className="table-wrap">
              <table className="table">
                <thead><tr>{r.columns.map((c) => <th key={c.key} className={['money', 'number', 'pct'].includes(c.type) ? 'num' : ''}>{c.label}</th>)}</tr></thead>
                <tbody>
                  {r.rows.length === 0 && <EmptyRow cols={r.columns.length}>Không có dữ liệu cho tháng này</EmptyRow>}
                  {r.rows.map((row, i) => (
                    <tr key={i}>
                      {r.columns.map((c, j) => (
                        <td key={c.key} className={['money', 'number', 'pct'].includes(c.type) ? 'num' : ''}>
                          {j === 0 && r.link ? <Link href={`${r.link.href}${row[r.link.key]}`}>{cell(row[c.key], c.type)}</Link> : cell(row[c.key], c.type)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {r.columns.some((c) => c.sum) && r.rows.length > 0 && (
                  <tfoot>
                    <tr>{r.columns.map((c, j) => (
                      <td key={c.key} className={c.sum ? 'num' : ''}>
                        {c.sum ? cell(r.rows.reduce((s, row) => s + Number(row[c.key] ?? 0), 0), c.type) : j === 0 ? 'Tổng cộng' : ''}
                      </td>
                    ))}</tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}

export default function ReportsPage() {
  return <Suspense><ReportsInner /></Suspense>;
}
