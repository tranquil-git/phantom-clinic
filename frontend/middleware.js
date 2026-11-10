import { NextResponse } from 'next/server';

// Chưa có cookie phiên → về trang đăng nhập. Cookie hết hạn thì API trả 401 và lib/api.js xử lý.
export function middleware(req) {
  const { pathname } = req.nextUrl;
  if (pathname === '/login' || req.cookies.has('clinic_token')) return NextResponse.next();
  const url = new URL('/login', req.url);
  if (pathname !== '/') url.searchParams.set('next', pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|icon.svg).*)'],
};
