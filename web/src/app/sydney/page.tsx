import type { Metadata } from 'next';
import MelbVeloExplorer from '@/components/MelbVeloExplorer';
import { CITY_CONFIGS } from '@/lib/cities';
import { SYDNEY_ROUTES } from '@/lib/sydney-routes-data';
import { createCsrfToken } from '@/lib/security';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'SpinMap Sydney — Visual Cycling Route Explorer',
  description:
    'Explore Sydney’s flat waterfront loops, Centennial Park greenways, Botany Bay beach paths, Narrabeen Lagoon gravel, Harbour Bridge rides, and custom doorstep Sydney cycling routes.',
};

export default async function SydneyPage() {
  const csrfToken = await createCsrfToken();
  return (
    <MelbVeloExplorer
      cityConfig={CITY_CONFIGS.sydney}
      routes={SYDNEY_ROUTES}
      csrfToken={csrfToken}
    />
  );
}
