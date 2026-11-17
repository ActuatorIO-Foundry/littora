import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly redis: Redis | null;

  constructor() {
    const url = process.env.REDIS_URL;
    this.redis = url
      ? new Redis(url, {
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
        })
      : null;

    this.redis?.on('error', () => {
      // Cache failures must never make beach recommendations unavailable.
    });
  }

  async getJson<T>(key: string): Promise<T | null> {
    if (!this.redis) return null;

    try {
      const cached = await this.redis.get(key);
      return cached ? (JSON.parse(cached) as T) : null;
    } catch {
      return null;
    }
  }

  async getManyJson<T>(keys: string[]): Promise<Array<T | null>> {
    if (!keys.length) return [];
    if (!this.redis) return keys.map(() => null);
    try {
      const values = await this.redis.mget(...keys);
      return values.map(value => {
        try { return value ? JSON.parse(value) as T : null; } catch { return null; }
      });
    } catch { return keys.map(() => null); }
  }

  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<boolean> {
    if (!this.redis) return false;

    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
      return true;
    } catch {
      // Non-blocking cache.
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis?.quit().catch(() => undefined);
  }
}
