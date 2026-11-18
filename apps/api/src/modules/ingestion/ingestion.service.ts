import { Injectable } from '@nestjs/common';
import { JobsService } from '../../jobs/jobs.service';

@Injectable()
export class IngestionService {
  constructor(private readonly jobs: JobsService) {}

  async waterQuality() {
    return this.jobs.enqueueWaterQuality();
  }
}
