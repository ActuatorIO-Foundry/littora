import { Injectable } from '@nestjs/common';
import { JobsService } from '../../jobs/jobs.service';

@Injectable()
export class IngestionService {
  constructor(private readonly jobs: JobsService) {}

  async waterQuality() {
    const sourceUrl = process.env.WATER_QUALITY_DATASET_URL;
    if (!sourceUrl) {
      return {
        ok: true,
        queued: false,
        warning: 'Set WATER_QUALITY_DATASET_URL to an official CSV/JSON resource, then run this endpoint again.',
      };
    }

    return this.jobs.enqueueWaterQuality(sourceUrl);
  }
}
