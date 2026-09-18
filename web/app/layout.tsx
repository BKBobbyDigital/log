import type { Metadata, Viewport } from 'next';
import './globals.css';
import RefreshOnFocus from '@/components/RefreshOnFocus';

export const metadata: Metadata = {
  title: 'LOG',
  description: 'Personal watch tracker',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'LOG' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f4f6' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0b0f' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="mx-auto max-w-2xl pb-16">
        <RefreshOnFocus />
        {children}
      </body>
    </html>
  );
}
