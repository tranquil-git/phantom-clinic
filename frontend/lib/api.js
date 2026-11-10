'use client';

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  if (res.status === 401 && !path.startsWith('/auth/login')) {
    // Phiên hết hạn: xóa cookie cũ rồi về đăng nhập (tránh middleware thấy cookie và vòng lặp)
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    throw new Error('Phiên đăng nhập đã hết hạn');
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Lỗi ${res.status}`);
  return data;
}

export const qs = (params) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  const str = s.toString();
  return str ? `?${str}` : '';
};
