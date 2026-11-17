import { Injectable } from '@nestjs/common';

@Injectable()
export class JobsService {
  async enqueueWaterQuality(_sourceUrl?: string) {
    return { queued: false, provider: 'unavailable', warning: 'Water quality import worker is not connected.' };
  }
}
