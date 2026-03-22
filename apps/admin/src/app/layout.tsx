import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Identity Admin',
  description: 'Admin dashboard for Identity Starter',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
