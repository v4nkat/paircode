import { createServer } from 'node:http';

const port = Number(process.env.COLLABORATION_PORT ?? 1234);
const host = process.env.COLLABORATION_HOST ?? '127.0.0.1';
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('Invalid collaboration port');

// Milestone 0: infrastructure lifecycle only. An unauthenticated Yjs relay must never be exposed.
const server = createServer((request, response) => {
  if (request.url === '/healthz' && request.method === 'GET') {
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(
      JSON.stringify({ service: 'collaboration', milestone: 0, collaborationReady: false }),
    );
    return;
  }
  response.writeHead(404);
  response.end();
});
server.on('upgrade', (_request, socket) => {
  socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
});
server.listen(port, host, () => {
  console.log(JSON.stringify({ service: 'collaboration', event: 'listening', port, milestone: 0 }));
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
