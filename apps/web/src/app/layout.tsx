import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Identity Starter',
  description: 'Identity Starter web app',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
