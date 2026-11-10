'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ROLE_LABEL } from '@/lib/format';
import { UserContext } from '@/lib/hooks';

// Menu theo nhóm use case; mỗi mục hiện khi vai trò có mã quyền tương ứng (GET /api/auth/me → permissions).
// Quản lý đổi quyền ở trang Phân quyền thì menu đổi theo ở lần tải trang kế tiếp.
const NAV = [
  ['Chung', [['/', 'Tổng quan', 'dashboard.read']]],
  ['Tiếp đón', [
    ['/appointments', 'Lịch hẹn', 'appointment.read'],
    ['/appointments/new', 'Đặt lịch', 'appointment.create'],
    ['/reminders', 'Nhắc hẹn', 'reminder.manage'],
    ['/patients', 'Bệnh nhân', 'patient.read'],
  ]],
  ['Điều trị', [
    ['/queue', 'Chờ khám', 'queue.read'],
    ['/plans', 'Liệu trình', 'plan.read'],
  ]],
  ['Thu ngân', [
    ['/billing', 'Hóa đơn', 'invoice.list'],
    ['/cash', 'Chốt két', 'cash.read'],
    ['/prices', 'Bảng giá', 'price.read'],
  ]],
  ['Quản trị', [
    ['/reports', 'Báo cáo', 'report.read'],
    ['/inventory', 'Kho', 'inventory.manage'],
    ['/admin/shifts', 'Ca trực', 'shift.write'],
    ['/admin/catalog', 'Danh mục', 'catalog.manage'],
    ['/admin/staff', 'Nhân viên', 'staff.manage'],
    ['/admin/permissions', 'Phân quyền', 'permission.read'],
  ]],
  ['Tài khoản', [['/account', 'Đổi mật khẩu', null]]],
];

export default function AppLayout({ children }) {
  const pathname = usePathname();
  const [user, setUser] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => { api('/auth/me').then(setUser).catch(() => {}); }, []);
  useEffect(() => setMenuOpen(false), [pathname]);

  if (!user) return <p className="content muted">Đang tải…</p>;

  const allowed = ([, , permission]) => !permission || user.permissions?.includes(permission);
  const links = NAV.flatMap(([, items]) => items).filter(allowed);
  // Mục đang mở = đường dẫn dài nhất khớp với trang hiện tại
  const active = links
    .map(([href]) => href)
    .filter((href) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`)))
    .sort((a, b) => b.length - a.length)[0];

  async function logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    window.location.href = '/login';
  }

  return (
    <UserContext.Provider value={user}>
      <div className="shell">
        <nav className={`sidebar ${menuOpen ? 'open' : ''}`} aria-label="Menu chính">
          <div className="brand">Nụ Cười Việt<small>Quản lý phòng khám</small></div>
          {NAV.map(([group, items]) => {
            const visible = items.filter(allowed);
            if (!visible.length) return null;
            return (
              <div key={group} className="nav-group">
                <div className="nav-title">{group}</div>
                {visible.map(([href, label]) => (
                  <Link key={href} href={href} className={`nav-link ${active === href ? 'active' : ''}`}>{label}</Link>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="main">
          <header className="topbar">
            <button type="button" className="btn btn-sm menu-toggle" onClick={() => setMenuOpen(!menuOpen)}>☰ Menu</button>
            <span className="spacer" />
            <span><strong>{user.full_name}</strong> <span className="muted">· {ROLE_LABEL[user.role]}</span></span>
            <button type="button" className="btn btn-sm" onClick={logout}>Đăng xuất</button>
          </header>
          <main className="content">{children}</main>
        </div>
      </div>
    </UserContext.Provider>
  );
}
