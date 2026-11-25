import MelbVeloExplorer from '@/components/MelbVeloExplorer';
import { CITY_CONFIGS } from '@/lib/cities';
import { MELBOURNE_ROUTES } from '@/lib/routes-data';
import { createCsrfToken } from '@/lib/security';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const csrfToken = await createCsrfToken();
  return (
    <MelbVeloExplorer
      cityConfig={CITY_CONFIGS.melbourne}
      routes={MELBOURNE_ROUTES}
      csrfToken={csrfToken}
    />
  );
}
