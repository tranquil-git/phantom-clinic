'use client';

import { APPT_STATUS, PLAN_STATUS } from '@/lib/format';

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children && <div className="row no-print">{children}</div>}
    </div>
  );
}

export function Alert({ error, ok, warn }) {
  if (error) return <div className="alert alert-error" role="alert">{error}</div>;
  if (warn) return <div className="alert alert-warn">{warn}</div>;
  if (ok) return <div className="alert alert-ok" role="status">{ok}</div>;
  return null;
}

export function Loading({ state }) {
  if (state.error) return <Alert error={state.error} />;
  if (state.loading && !state.data) return <p className="muted">Đang tải…</p>;
  return null;
}

export function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span>{label} {hint && <em className="hint">— {hint}</em>}</span>
      {children}
    </label>
  );
}

export function Modal({ title, onClose, children, footer, wide }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="btn btn-sm" onClick={onClose} aria-label="Đóng">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(([key, label]) => (
        <button key={key} type="button" role="tab" aria-selected={value === key}
          className={`tab ${value === key ? 'active' : ''}`} onClick={() => onChange(key)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function StatusBadge({ status }) {
  return <span className={`badge badge-${status}`}>{APPT_STATUS[status] ?? status}</span>;
}

export function PlanBadge({ status }) {
  const cls = status === 'active' ? 'active' : status === 'cancelled' ? 'danger' : '';
  return <span className={`badge badge-${cls}`}>{PLAN_STATUS[status] ?? status}</span>;
}

export function Progress({ done, total }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="row nowrap">
      <div className="progress" style={{ flex: 1 }}><div style={{ width: `${pct}%` }} /></div>
      <span className="small muted">{done}/{total}</span>
    </div>
  );
}

export function EmptyRow({ cols, children = 'Không có dữ liệu' }) {
  return <tr><td colSpan={cols} className="empty">{children}</td></tr>;
}
