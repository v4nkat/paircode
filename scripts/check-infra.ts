import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { strict as assert } from 'node:assert';

const compose = parse(readFileSync('infra/compose.yaml', 'utf8')) as {
  services: Record<string, { ports?: string[]; volumes?: string[]; privileged?: boolean }>;
};
for (const [name, service] of Object.entries(compose.services)) {
  assert(!service.privileged, `${name}: privileged application containers are forbidden`);
  for (const port of service.ports ?? [])
    assert(port.startsWith('127.0.0.1:'), `${name}: bind development ports to loopback`);
  for (const volume of service.volumes ?? [])
    assert(!volume.includes('docker.sock'), `${name}: Docker socket mounting is forbidden`);
}
console.log(
  'Compose YAML and local exposure policy passed. This does not replace docker compose config or container tests.',
);
