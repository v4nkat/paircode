import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export async function migrationSql() {
  const root = 'packages/database/prisma/migrations';
  const directories = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  return (
    await Promise.all(
      directories.map((directory) => readFile(join(root, directory, 'migration.sql'), 'utf8')),
    )
  ).join('\n');
}
