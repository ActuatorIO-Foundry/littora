import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

type QueueLike = {
  add: (name: string, data: Record<string, unknown>) => Promise<unknown>;
  close: () => Promise<void>;
};

type WorkerLike = {
  close: () => Promise<void>;
};

@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private queue: QueueLike | null = null;
  private worker: WorkerLike | null = null;
  private ready = false;

  async onModuleInit(): Promise<void> {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) return;

    try {
      const bullmq = await this.loadBullMq();
      const connection = { url: redisUrl };
      this.queue = new bullmq.Queue('littora-ingestion', { connection });
      this.worker = new bullmq.Worker(
        'littora-ingestion',
        async (job: { name: string; data: Record<string, unknown> }) => ({
          ok: true,
          job: job.name,
          data: job.data,
          processedAt: new Date().toISOString(),
        }),
        { connection },
      );
      this.ready = true;
    } catch {
      this.ready = false;
    }
  }

  async enqueueWaterQuality(sourceUrl?: string) {
    if (!this.queue) {
      return {
        queued: false,
        provider: 'inline-fallback',
        warning: 'BullMQ indisponible localement. Docker installera la dépendance via package.json.',
      };
    }

    const job = await this.queue.add('water-quality-import', {
      sourceUrl: sourceUrl ?? process.env.WATER_QUALITY_DATASET_URL ?? null,
    });
    return { queued: true, provider: 'bullmq', job };
  }

  status() {
    return {
      provider: 'bullmq',
      ready: this.ready,
      queue: 'littora-ingestion',
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }

  private async loadBullMq(): Promise<any> {
    const dynamicImport = new Function('specifier', 'return import(specifier)');
    return dynamicImport('bullmq');
  }
}
