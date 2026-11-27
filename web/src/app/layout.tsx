import type { Metadata } from 'next';
import { headers } from 'next/headers';
import './globals.css';

export const metadata: Metadata = {
  title: 'SpinMap — Visual Cycling Route Explorer',
  description:
    'Discover flat, coastal, riverside, greenway, and hill cycling routes — or design a custom ride from your address with real bikeways, elevation scrubbing, and 1-tap Google Maps navigation.',
  robots: {
    index: false,
    follow: false,
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang="en-AU" data-nonce={nonce}>
      <body className="antialiased min-h-screen">{children}</body>
    </html>
  );
}
