import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const isGitHubPages = process.env.GITHUB_PAGES === 'true';
const [githubOwner = 'JakubGal', githubRepository = 'rcj-soccer-lab'] = (
  process.env.GITHUB_REPOSITORY ?? 'JakubGal/rcj-soccer-lab'
).split('/');
const isOwnerSite =
  githubRepository.toLowerCase() === `${githubOwner.toLowerCase()}.github.io`;
const githubPagesBasePath = isOwnerSite ? '' : `/${githubRepository}`;
const githubPagesUrl = isGitHubPages
  ? `https://${githubOwner.toLowerCase()}.github.io${githubPagesBasePath}`
  : undefined;
const previewImageUrl = githubPagesUrl
  ? `${githubPagesUrl}/rcj-soccer-lab-preview.png`
  : '/rcj-soccer-lab-preview.png';
const faviconUrl = githubPagesUrl
  ? `${githubPagesUrl}/favicon.svg`
  : '/favicon.svg';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  ...(githubPagesUrl ? { metadataBase: new URL(githubPagesUrl) } : {}),
  title: {
    default: 'RCJ Soccer Lab',
    template: '%s · RCJ Soccer Lab',
  },
  description:
    'Explore the complete RoboCupJunior Soccer 2026 rulebook with 3D examples, interactive inspections, referee practice, and playable matches.',
  ...(githubPagesUrl ? { alternates: { canonical: githubPagesUrl } } : {}),
  icons: {
    icon: faviconUrl,
  },
  openGraph: {
    title: 'RCJ Soccer Lab',
    description:
      'Interactive 3D rules and referee training for RoboCupJunior Soccer 2026.',
    type: 'website',
    ...(githubPagesUrl ? { url: githubPagesUrl } : {}),
    images: [
      {
        url: previewImageUrl,
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
