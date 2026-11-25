import { NextResponse } from 'next/server';
import { createCsrfToken } from '@/lib/security';

export async function GET(): Promise<NextResponse> {
  const csrfToken = await createCsrfToken();
  return NextResponse.json(
    { csrfToken },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    }
  );
}
