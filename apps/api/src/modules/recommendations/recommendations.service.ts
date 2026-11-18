import { Injectable } from '@nestjs/common';
import { BeachesService } from '../beaches/beaches.service';
import { CacheService } from '../../cache/cache.service';
import { conditionKey, searchConditions } from '../search/search-conditions';

type Usage = 'bathing' | 'family' | 'paddle' | 'boat';
const allowedUsages: Usage[] = ['bathing', 'family', 'paddle', 'boat'];

@Injectable()
export class RecommendationsService {
  constructor(
    private beaches: BeachesService,
    private cache: CacheService,
  ) {}

  async best(lat: number, lon: number, usage = 'bathing') {
    const selectedUsage: Usage = allowedUsages.includes(usage as Usage) ? (usage as Usage) : 'bathing';
    const beaches: Awaited<ReturnType<BeachesService['get']>>[] = await this.beaches.list(lat, lon, 30);
    const closed=await this.beaches.closedForBathing();
    const snapshots = await this.cache.getManyJson<Record<string, any>>(beaches.map(b => conditionKey(b.id)));
    const now = Date.now();
    const enriched = beaches.map((beach,i) => {
      const { scores, waterTemp, airTemp, conditions } = searchConditions(beach,snapshots[i],now);
      if(closed.has(beach.id)){scores.bathing=0;scores.family=0;}
      const dataStatus = Object.fromEntries(Object.entries({ weather: conditions.weather, marine: conditions.marine }).filter(([,v]) => v));
      return { ...beach, scores, selectedScore: scores[selectedUsage], waterTemp, airTemp, dataStatus,
        flag: closed.has(beach.id) ? 'red' : conditions.weather && conditions.marine ? snapshots[i]?.estimatedFlag ?? 'unknown' : 'unknown' };
    });
    return enriched.filter(b=>!['bathing','family'].includes(selectedUsage)||!closed.has(b.id)).sort((a, b) => (b.selectedScore ?? -1) - (a.selectedScore ?? -1));
  }
}
