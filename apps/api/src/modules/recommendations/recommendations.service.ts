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
      const { scores, explanations, waterTemp, airTemp, conditions } = searchConditions(beach,snapshots[i],now,closed.has(beach.id));
      const dataStatus = Object.fromEntries(Object.entries({ weather: conditions.weather, marine: conditions.marine }).filter(([,v]) => v));
      return { ...beach, scores, scoreExplanation:explanations[selectedUsage], selectedScore: scores[selectedUsage], waterTemp, airTemp, dataStatus,
        bathingRestriction: closed.has(beach.id) ? 'closed' : 'unknown',
        flag: !closed.has(beach.id) && conditions.weather && conditions.marine ? snapshots[i]?.estimatedFlag ?? 'unknown' : 'unknown' };
    });
    return enriched.filter(b => b.scoreExplanation.status === 'calculated' && (b.selectedScore ?? 0) > 0)
      .sort((a,b) => b.selectedScore! - a.selectedScore!);
  }
}
