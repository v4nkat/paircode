export function GET() {
  return Response.json(
    { service: 'web', milestone: 0, status: 'ok' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
