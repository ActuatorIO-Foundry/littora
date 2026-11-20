import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { edition } from '../modules/water-quality/ars-source';

@Injectable()
export class JobsService {
  async enqueueWaterQuality() {
    const url=process.env.JOBS_REDIS_URL || process.env.REDIS_URL;
    if(process.env.ARS_IMPORT_ENABLED!=='true')return {queued:false,provider:'ars-rapportage',warning:'Import ARS désactivé.'};
    if(!url)throw new ServiceUnavailableException('File sanitaire indisponible');
    const queue=new Queue('littora-ars',{connection:{url,enableOfflineQueue:false,maxRetriesPerRequest:1,connectTimeout:3000,retryStrategy:()=>null}});
    queue.on('error', () => console.error('{"event":"ars_queue_unavailable"}'));
    try {
      await queue.waitUntilReady();
      const job=await queue.add('import',{},{deduplication:{id:edition},attempts:1,removeOnComplete:50,removeOnFail:50});
      return {queued:true,provider:'ars-rapportage',queue:queue.name,jobId:job.id};
    }catch{throw new ServiceUnavailableException('File sanitaire indisponible');}
    finally{await queue.close();}
  }
}
