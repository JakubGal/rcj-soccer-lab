import { env as cloudflareEnv } from 'cloudflare:workers';
import hostingConfigJson from '../.openai/hosting.json';

type HostingConfig = { d1: string | null };

export class DatabaseUnavailableError extends Error {
  constructor() {
    super('The certification database has not been provisioned.');
    this.name = 'DatabaseUnavailableError';
  }
}

export function getD1Database(): D1Database {
  const bindingName = (hostingConfigJson as HostingConfig).d1;
  if (!bindingName) throw new DatabaseUnavailableError();
  const binding = (cloudflareEnv as unknown as Record<string, unknown>)[
    bindingName
  ];
  if (!binding || typeof (binding as D1Database).prepare !== 'function')
    throw new DatabaseUnavailableError();
  return binding as D1Database;
}
