"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JobsService = void 0;
const common_1 = require("@nestjs/common");
let JobsService = class JobsService {
    constructor() {
        this.queue = null;
        this.worker = null;
        this.ready = false;
    }
    async onModuleInit() {
        const redisUrl = process.env.REDIS_URL;
        if (!redisUrl)
            return;
        try {
            const bullmq = await this.loadBullMq();
            const connection = { url: redisUrl };
            this.queue = new bullmq.Queue('littora-ingestion', { connection });
            this.worker = new bullmq.Worker('littora-ingestion', async (job) => ({
                ok: true,
                job: job.name,
                data: job.data,
                processedAt: new Date().toISOString(),
            }), { connection });
            this.ready = true;
        }
        catch {
            this.ready = false;
        }
    }
    async enqueueWaterQuality(sourceUrl) {
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
    async onModuleDestroy() {
        await this.worker?.close().catch(() => undefined);
        await this.queue?.close().catch(() => undefined);
    }
    async loadBullMq() {
        const dynamicImport = new Function('specifier', 'return import(specifier)');
        return dynamicImport('bullmq');
    }
};
exports.JobsService = JobsService;
exports.JobsService = JobsService = __decorate([
    (0, common_1.Injectable)()
], JobsService);
//# sourceMappingURL=jobs.service.js.map