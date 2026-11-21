import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { CacheService } from '../../cache/cache.service';
import { BeachesService } from '../beaches/beaches.service';
import { beachRuleDay } from '../beaches/beach-rule-day';
import { PlacesService } from '../places/places.service';
import { ReportsService } from '../reports/reports.service';
import { conditionKey, searchConditions } from './search-conditions';
import { SearchInput, validateSearch } from './search-input';

type Snapshot = { closedKey: string; communityKey:string; hash: string; asOf: string; expiresAt: string; items: any[];
  commune: any; coverage: { candidates: number; waterTemperature: number; airTemperature: number; scores: number; flags: number } };

@Injectable()
export class SearchService {
  constructor(private readonly beaches: BeachesService, private readonly places: PlacesService,
    private readonly reports: ReportsService, private readonly cache: CacheService) {}

  async search(input: SearchInput) {
    validateSearch(input);
    const { cursor, ...criteria } = input;
    const limit = input.limit ?? 200;
    const hash = createHash('sha256').update(JSON.stringify(Object.entries(criteria).sort(([a],[b]) => a.localeCompare(b)))).digest('hex');
    const [closed,live]=await Promise.all([this.beaches.closedForBathing(),this.reports.activeCommunity()]);
    const closedKey=createHash('sha256').update([...closed].join(',')).digest('hex');
    let snapshot: Snapshot, id = randomUUID(), offset = 0;
    if (cursor) {
      const match = /^([a-f0-9-]{36}):([1-9][0-9]*)$/.exec(cursor);
      if (!match) throw new BadRequestException('Invalid search cursor');
      id = match[1] as typeof id; offset = Number(match[2]);
      const saved = await this.cache.getJson<Snapshot>(`search:page:v5:${id}`);
      if (!saved || saved.closedKey!==closedKey || saved.communityKey!==live.key || Date.parse(saved.expiresAt) <= Date.now()) throw new ConflictException('Search expired; restart from first page');
      if (saved.hash !== hash || !Number.isSafeInteger(offset) || offset >= saved.items.length || offset % limit) {
        throw new BadRequestException('Cursor does not match search');
      }
      if ((input.dogAccess || input.naturism) && beachRuleDay(new Date(saved.asOf)) !== beachRuleDay(new Date())) {
        throw new ConflictException('Search expired; restart from first page');
      }
      snapshot = saved;
    } else {
      const commune = input.communeCode ? await this.places.get(input.communeCode) : null;
      const at = new Date();
      const candidates = await this.beaches.searchCandidates(input, commune, at);
      const cached = await this.cache.getManyJson<Record<string, any>>(candidates.map(b => conditionKey(b.id)));
      const flags = await this.reports.flagConsensuses(candidates.map(b => b.id));
      const now = at.getTime(), usage = input.usage ?? 'bathing';
      const enriched = candidates.map((beach, i) => {
        const {explanations,estimatedFlag,...conditions} = searchConditions(beach, cached[i], now, closed.has(beach.id),live.byBeach.get(beach.id));
        const community = flags.get(beach.id);
        return { ...beach, ...conditions, scoreExplanation:explanations[usage], bathingRestriction:closed.has(beach.id)?'closed':'unknown', selectedScore: conditions.scores[usage],
          flag: community?.flag ?? null, flagSource: community?.flag ? 'community' : null,
          recentRedAt: community?.recentRedAt ?? null };
      });
      const range = (value: number | null, min?: number, max?: number) =>
        min === undefined && max === undefined || value !== null && (min === undefined || value >= min) && (max === undefined || value <= max);
      const items = enriched.filter(b => (!input.flag || b.flag === input.flag) &&
        range(b.waterTemp, input.minWaterTemp, input.maxWaterTemp) &&
        range(b.airTemp, input.minAirTemp, input.maxAirTemp) && range(b.selectedScore, input.minScore));
      const names = new Intl.Collator('fr', { sensitivity: 'base' });
      items.sort((a,b) => (input.sort === 'score' ? (b.selectedScore ?? -1) - (a.selectedScore ?? -1)
        : input.sort === 'distance' ? (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity)
        : names.compare(a.name,b.name)) || a.id.localeCompare(b.id));
      snapshot = { closedKey, communityKey:live.key, hash, asOf: new Date(now).toISOString(), expiresAt: new Date(now + 120_000).toISOString(), items, commune,
        coverage: { candidates: candidates.length, waterTemperature: enriched.filter(b => b.waterTemp !== null).length,
          airTemperature: enriched.filter(b => b.airTemp !== null).length,
          scores: enriched.filter(b => b.selectedScore !== null).length, flags: enriched.filter(b => b.flag !== null).length } };
      // A frozen short-lived result prevents changing weather or reports from duplicating/skipping pages.
      if (items.length > limit && !await this.cache.setJson(`search:page:v5:${id}`, snapshot, 120)) {
        throw new ServiceUnavailableException('Stable pagination unavailable');
      }
    }
    const nextCursor = offset + limit < snapshot.items.length ? `${id}:${offset + limit}` : null;
    return { items: snapshot.items.slice(offset, offset + limit), total: snapshot.items.length,
      pageInfo: { nextCursor, hasNextPage: nextCursor !== null, limit }, asOf: snapshot.asOf, expiresAt: snapshot.expiresAt,
      commune: snapshot.commune, coverage: snapshot.coverage, unknownPolicy: 'exclude-when-filtered' as const };
  }
}
