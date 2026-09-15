import { config } from 'dotenv';
import { problems } from '@paircode/problem-catalog';
import type { Prisma } from './generated/client.js';
import { createDatabase } from './index.js';

config({ path: '../../.env', quiet: true });
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const database = createDatabase(process.env.DATABASE_URL);
try {
  for (const problem of problems) {
    const { tests, ...record } = problem;
    // Versioned seed records are insert-only. Update a problem by publishing a new version.
    await database.problem.upsert({
      where: { slug_version: { slug: problem.slug, version: problem.version } },
      update: {},
      create: {
        ...record,
        tests: {
          create: tests.map((test, ordering) => ({
            ...test,
            ordering,
            input: test.input as Prisma.InputJsonValue,
            expectedOutput: test.expectedOutput as Prisma.InputJsonValue,
          })),
        },
      },
    });
  }
  console.log(`Seeded ${problems.length} immutable problem versions.`);
} finally {
  await database.$disconnect();
}
