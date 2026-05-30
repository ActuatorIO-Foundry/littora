import { Injectable } from '@nestjs/common';
import { BeachesService } from '../beaches/beaches.service';
import { ScoreService } from '../score/score.service';

type Usage = 'bathing' | 'family' | 'paddle' | 'boat';
const allowedUsages: Usage[] = ['bathing', 'family', 'paddle', 'boat'];

@Injectable()
export class RecommendationsService {
  constructor(
    private beaches: BeachesService,
    private scores: ScoreService,
  ) {}

  async best(lat: number, lon: number, usage = 'bathing') {
    const selectedUsage: Usage = allowedUsages.includes(usage as Usage) ? (usage as Usage) : 'bathing';
    const beaches = await this.beaches.list(lat, lon, 30);
    const enriched: Array<Record<string, any> & { selectedScore: number }> = [];

    for (const beach of beaches) {
      try {
        const score = await this.scores.scoreBeach(beach.id);
        enriched.push({
          ...beach,
          scores: score.scores,
          selectedScore: score.scores[selectedUsage] ?? score.scores.bathing,
        });
      } catch {
        // Ignore beaches that cannot currently be scored because one provider failed.
      }
    }

    return enriched.sort((a, b) => b.selectedScore - a.selectedScore);
  }
}
