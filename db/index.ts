import { drizzle } from 'drizzle-orm/d1';
import { getD1Database } from './env';
import { schema } from './schema';

export function database() {
  return drizzle(getD1Database(), { schema });
}

export { getD1Database } from './env';
export * from './schema';
