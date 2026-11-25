import { NextResponse } from 'next/server';

export function GET(): NextResponse {
  return NextResponse.json(
    { status: 'ok', service: 'spinmap-web' },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    }
  );
}
