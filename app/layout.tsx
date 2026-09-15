import type { Metadata } from 'next';
// The design system loads first, so every stylesheet after it reads from the
// same roles rather than from a colour somebody typed in.
import './material-theme.css';
import './globals.css';
import './map-controls.css';
import './transit-interface.css';
import './workspace.css';
import './settings-workspace.css';
import './journey-time.css';
import './vehicle-preferences.css';
import './dim-sum.css';
import './comfort.css';
import './about.css';
import './notifications.css';
import './history-panel.css';
import './command-palette.css';
import './catch-vehicle.css';
import './appearance.css';
import './scheduled-settings.css';
import './tab-strip.css';
import './locks.css';
// The shell loads last so its navigation rules win over the old workspace ones.
import './shell.css';
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
    // A real capture of the built composer, cropped to the widely-used Open
    // Graph size by scripts/site/build-social-preview.mjs and committed at
    // public/social-preview.png. metadataBase above turns this relative path
    // into an absolute https URL, which is the one thing a link-preview
    // crawler actually requires.
    images: [{ url: '/social-preview.png', width: 1200, height: 630, alt: 'The GTHA Transit journey planner' }],
  },
  twitter: {
    card: 'summary_large_image',
    images: ['/social-preview.png'],
  },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* The browser chrome follows the scheme, and these are the generated
            surface roles rather than a colour typed in beside them. */}
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#071327" />
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#fcf9f0" />
        <link rel="icon" href="/favicon.svg" />
      </head>
      <body>{children}</body>
    </html>
  );
}
