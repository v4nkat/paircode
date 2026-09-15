import { config } from 'dotenv';
import {
  infrastructureEnvSchema,
  parseEnvironment,
  webEnvSchema,
  workerEnvSchema,
} from '@paircode/config';

config({ path: '.env', quiet: true });
const target = process.argv[2] ?? 'infrastructure';
const schemas = {
  infrastructure: infrastructureEnvSchema,
  web: webEnvSchema,
  worker: workerEnvSchema,
};
if (!(target in schemas)) throw new Error('Choose infrastructure, web, or worker');
parseEnvironment(schemas[target as keyof typeof schemas], process.env);
console.log(`Environment valid for ${target}. Values are intentionally not printed.`);
