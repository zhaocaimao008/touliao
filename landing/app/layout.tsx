import type { Metadata, Viewport } from 'next';
import './globals.css';
import { site } from '@/lib/content';

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: `${site.name} — ${site.tagline}`,
  description:
    'v信 是一款私有化部署的私密通讯应用：聊天、朋友圈、收藏三端实时同步，数据自主可控。',
  keywords: ['v信', '私有化部署', '私密通讯', '即时通讯', '朋友圈', '收藏'],
  openGraph: {
    title: `${site.name} — ${site.tagline}`,
    description:
      '私有化部署的私密通讯。聊天、朋友圈、收藏，三端实时同步。',
    siteName: site.name,
    type: 'website',
    locale: 'zh_CN',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${site.name} — ${site.tagline}`,
    description: '私有化部署的私密通讯。三端实时同步。',
  },
};

export const viewport: Viewport = {
  themeColor: '#059682',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
