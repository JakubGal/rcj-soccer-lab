import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: {
    default: 'RCJ Soccer Lab',
    template: '%s · RCJ Soccer Lab',
  },
  description:
    'Explore RoboCupJunior Soccer 2026 situations in 3D, learn observable rule evidence, and practise referee decisions.',
  openGraph: {
    title: 'RCJ Soccer Lab',
    description:
      'Interactive 3D rules and referee training for RoboCupJunior Soccer 2026.',
    type: 'website',
    images: [
      {
        url: '/rcj-soccer-lab-preview.png',
        width: 1731,
        height: 909,
        alt: 'RCJ Soccer Lab interactive rules and referee training',
      },
    ],
  },
};

export const viewport = {
  themeColor: '#0b1118',
  colorScheme: 'dark',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
