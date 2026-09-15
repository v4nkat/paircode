import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

config({ path: '../../.env', quiet: true });
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // Generation and schema validation need no live database. Migration requires .env.
    url: process.env.DATABASE_URL ?? 'postgresql://unconfigured@127.0.0.1:5432/unconfigured',
  },
});
