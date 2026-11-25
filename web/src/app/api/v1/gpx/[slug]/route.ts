import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { findRouteBySlug } from '@/lib/routes-data';
import { SYDNEY_ROUTES } from '@/lib/sydney-routes-data';
import { escapeXml, validateRouteSlug } from '@/lib/security';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ slug: string }> }
): Promise<NextResponse> {
  const { slug: rawSlug } = await context.params;
  const cleanSlug = validateRouteSlug(rawSlug);
  if (!cleanSlug) {
    return NextResponse.json({ error: 'Invalid route identifier.' }, { status: 400 });
  }

  // Defense-in-depth filename sanitization
  const safeBase = path.basename(cleanSlug);
  const route = findRouteBySlug(safeBase) ?? SYDNEY_ROUTES.find((r) => r.id === safeBase);
  if (!route) {
    return NextResponse.json({ error: 'Route not found.' }, { status: 404 });
  }

  const trkpts = route.coordinates
    .map(([lng, lat]) => `      <trkpt lat="${lat.toFixed(5)}" lon="${lng.toFixed(5)}"></trkpt>`)
    .join('\n');

  const gpxXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="SpinMap" xmlns="http://www.topografix.com/GPX/1/1">',
    '  <metadata>',
    `    <name>${escapeXml(route.name)}</name>`,
    `    <desc>${escapeXml(route.subtitle)}</desc>`,
    '  </metadata>',
    '  <trk>',
    `    <name>${escapeXml(route.name)}</name>`,
    '    <trkseg>',
    trkpts,
    '    </trkseg>',
    '  </trk>',
    '</gpx>',
  ].join('\n');

  return new NextResponse(gpxXml, {
    status: 200,
    headers: {
      'Content-Type': 'application/gpx+xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safeBase}.gpx"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  });
}
