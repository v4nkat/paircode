import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const excluded = new Set([
  'node_modules',
  '.next',
  '.git',
  'generated',
  '.codebook',
  'test-results',
  'playwright-report',
]);
const files = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (
      excluded.has(entry.name) ||
      (entry.name.startsWith('.env') && entry.name !== '.env.example')
    )
      continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (
      /\.(ts|tsx|mjs|css|prisma|sql|ya?ml|json|toml|Dockerfile)$/.test(entry.name) &&
      entry.name !== 'pnpm-lock.yaml' &&
      entry.name !== 'next-env.d.ts' &&
      !entry.name.endsWith('.tsbuildinfo')
    )
      files.push(file);
  }
}
await walk(root);
let output =
  '# Milestone 0 source walkthrough\n\nComplete source files and verification commands. Generated dependency files and secrets are excluded.\n\n';
for (const file of files.sort()) {
  const relative = path.relative(root, file).replaceAll('\\', '/');
  const command = relative.includes('tests/e2e')
    ? 'pnpm test:e2e'
    : relative.includes('tests/integration')
      ? 'pnpm test:integration'
      : relative.includes('tests/unit')
        ? 'pnpm test:unit'
        : relative.endsWith('.prisma')
          ? 'pnpm db:validate'
          : relative.endsWith('.sql')
            ? 'pnpm test:integration'
            : relative.includes('apps/web')
              ? 'pnpm typecheck && pnpm build'
              : 'pnpm check';
  output += `## ${relative}\n\nPurpose: ${purpose(relative)}\n\nVerify: \`${command}\`\n\n\`\`\`${path.extname(file).slice(1)}\n${await readFile(file, 'utf8')}\n\`\`\`\n\n`;
}
function purpose(file) {
  if (file.includes('/tests/') || file.startsWith('tests/'))
    return 'Verify the behavior named by this test using the appropriate unit, SQL, or browser runner.';
  if (file.includes('schema.prisma'))
    return 'Define durable entities and relationships for Prisma generation.';
  if (file.endsWith('.sql'))
    return 'Create database tables, indexes, constraints, and immutable-record triggers.';
  if (file.includes('contracts'))
    return 'Define validated public inputs or explicitly safe response projections.';
  if (file.includes('problem-catalog'))
    return 'Define versioned server-side development problems and tests.';
  if (file.includes('apps/web'))
    return 'Render or configure the public foundation preview without claiming future features are available.';
  if (file.includes('collaboration'))
    return 'Configure or run the collaboration lifecycle foundation with WebSocket access closed.';
  if (file.includes('worker'))
    return 'Reserve the execution boundary and refuse job consumption until a sandbox is integrated.';
  if (file.includes('database'))
    return 'Configure database generation, connection, or immutable catalog seeding.';
  return 'Configure, validate, or document the repository foundation and its verification workflow.';
}
await mkdir('.codebook', { recursive: true });
await writeFile('.codebook/milestone-0-source.md', output);
console.log('Wrote .codebook/milestone-0-source.md');
