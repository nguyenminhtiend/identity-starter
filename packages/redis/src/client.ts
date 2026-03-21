import { Redis } from 'ioredis';

export interface RedisConfig {
  url: string;
}

export function createRedisClient(config: RedisConfig): Redis {
  const client = new Redis(config.url, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });

  client.on('error', (err: Error) => {
    // biome-ignore lint/suspicious/noConsole: infra-level error logging before app logger is available
    console.error('Redis connection error:', err.message);
  });

  return client;
}

export async function healthCheck(client: Redis): Promise<boolean> {
  try {
    const result = await client.ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}
