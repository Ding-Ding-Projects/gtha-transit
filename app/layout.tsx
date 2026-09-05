import type { Metadata } from 'next';
import './globals.css';
import './map-controls.css';
import './transit-interface.css';
import './workspace.css';
export const metadata: Metadata = {
  title: 'GTHA Transit | Your next connection',
  description:
    'Independent transit planning for Greater Toronto and Hamilton. Compare journeys, find stops, and check live TTC subway and light rail alerts.',
  metadataBase: new URL('https://toronto-transit.org'),
  openGraph: {
    title: 'GTHA Transit',
    description: 'Your region. Your next connection.',
    url: 'https://toronto-transit.org',
    type: 'website',
    siteName: 'GTHA Transit',
  },
  twitter: { card: 'summary_large_image' },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta name="theme-color" content="#123f32" />
        <link rel="icon" href="/favicon.svg" />
      </head>
      <body>{children}</body>
    </html>
  );
}
