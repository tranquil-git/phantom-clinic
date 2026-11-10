'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ROLE, ROLE_LABEL } from '@/lib/format';
import { UserContext } from '@/lib/hooks';

const { receptionist: R, dentist: D, manager: M } = ROLE;
const ALL = [R, D, M];

// Menu theo nhóm use case; mỗi mục chỉ hiện với vai trò được dùng
const NAV = [
  ['Chung', [['/', 'Tổng quan', ALL]]],
  ['Tiếp đón', [
    ['/appointments', 'Lịch hẹn', ALL],
    ['/appointments/new', 'Đặt lịch', [R, D]],
    ['/reminders', 'Nhắc hẹn', [R]],
    ['/patients', 'Bệnh nhân', ALL],
  ]],
  ['Điều trị', [
    ['/queue', 'Chờ khám', [D, M]],
    ['/plans', 'Liệu trình', ALL],
  ]],
  ['Thu ngân', [
    ['/billing', 'Hóa đơn', [R, M]],
    ['/cash', 'Chốt két', [R, M]],
    ['/prices', 'Bảng giá', ALL],
  ]],
  ['Quản trị', [
    ['/reports', 'Báo cáo', [M]],
    ['/inventory', 'Kho', [M]],
    ['/admin/shifts', 'Ca trực', [M]],
    ['/admin/catalog', 'Danh mục', [M]],
    ['/admin/staff', 'Nhân viên', [M]],
  ]],
];

export default function AppLayout({ children }) {
  const pathname = usePathname();
  const [user, setUser] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => { api('/auth/me').then(setUser).catch(() => {}); }, []);
  useEffect(() => setMenuOpen(false), [pathname]);

  if (!user) return <p className="content muted">Đang tải…</p>;

  const links = NAV.flatMap(([, items]) => items).filter(([, , roles]) => roles.includes(user.role));
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
            const visible = items.filter(([, , roles]) => roles.includes(user.role));
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
