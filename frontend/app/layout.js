import './globals.css';

export const metadata = {
  title: 'Nha khoa Nụ Cười Việt',
  description: 'Hệ thống quản lý phòng khám nha khoa',
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
