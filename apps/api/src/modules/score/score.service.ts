import { Injectable } from '@nestjs/common';
import { BeachesService } from '../beaches/beaches.service';
import { MarineService, unavailableMarine } from '../marine/marine.service';
import { ReportsService } from '../reports/reports.service';
import { TidesService, unavailableTides } from '../tides/tides.service';
import { WaterQualityService } from '../water-quality/water-quality.service';
import { WeatherService } from '../weather/weather.service';
import { finiteMetric } from '../../shared/forecast-data';
import { measured } from './comfort-model';
import { CacheService } from '../../cache/cache.service';
import { conditionKey, conditionSnapshot, searchConditions } from '../search/search-conditions';

@Injectable()
export class ScoreService {
  constructor(
    private beaches: BeachesService,
    private weather: WeatherService,
    private marine: MarineService,
    private tides: TidesService,
    private water: WaterQualityService,
    private reports: ReportsService,
    private cache: CacheService,
  ) {}

  async scoreBeach(id: string, requireProjection = false) {
    const beach = await this.beaches.get(id);
    const [weather, marine, tides, waterQuality, community, flagConsensus] = await Promise.all([
      this.weather.get(beach.lat, beach.lon),
      beach.waterType === 'sea' ? this.marine.get(beach.lat, beach.lon) : unavailableMarine(),
      beach.waterType === 'sea' ? this.tides.get(beach.lat, beach.lon) : unavailableTides(),
      this.water.get(id, beach.lat, beach.lon),
      this.reports.aggregate(id),
      this.reports.flagConsensus(id),
    ]);

    const wc = weather.current;
    const mc = marine.current;
    const dataStatus = { weather: this.dataStatus(weather), marine: this.dataStatus(marine) };
    const current = { weather: wc, marine: mc, tides, waterQuality, community };
    const closed = waterQuality.status === 'closed';
    const projection = conditionSnapshot({ beach, current, dataStatus });
    const { scores, explanations, conditions } = searchConditions(beach, projection, Date.now(), closed);
    const { bathing } = scores;
    const metric = (group: 'weather' | 'marine', key: string) => conditions[group]
      ? measured(key,current[group][key],dataStatus[group].units[key]) : null;
    const labels:Record<string,string> = {jellyfish:'Signalements méduses',current:'Signalements courant',pollution:'Signalements pollution',crowd:'Affluence signalée'};
    const communityAlerts = Object.entries(labels).filter(([type]) => community.some((r:{type:string}) => r.type===type)).map(([,label])=>label);

    const now = Date.now();
    const result = {
      beach,
      current, scores, explanations,
      safety: this.safety(bathing, metric('marine','wave_height'), metric('marine','ocean_current_velocity'),
        metric('weather','uv_index'), metric('weather','wind_speed_10m'), waterQuality.status, communityAlerts, flagConsensus),
      summary: Object.fromEntries(Object.entries(explanations).map(([usage,e])=>[usage,
        e.status === 'closed' ? 'Baignade interdite' : e.status === 'not-applicable' ? 'Modèle marin non applicable' :
        e.score === null ? 'Données insuffisantes' : `Indice de confort : ${e.score}/100`])),
      forecast: {
        uv: this.series(weather.raw?.hourly, 'uv_index', now),
        air: this.series(weather.raw?.hourly, 'temperature_2m', now),
        water: this.series(marine.raw?.hourly, 'sea_surface_temperature', now),
        wave: this.series(marine.raw?.hourly, 'wave_height', now),
        current: this.series(marine.raw?.hourly, 'ocean_current_velocity', now),
      },
      reliability: {
        weather: weather.status ?? 'unknown',
        marine: marine.status ?? 'unknown',
        tides: tides.reliability ?? 'unknown',
        waterQuality: waterQuality.reliability ?? 'unknown',
        community: community.length || flagConsensus ? 'fresh' : 'none',
      },
      dataStatus,
      providers: {
        weather: weather.provider,
        marine: marine.provider,
        tides: tides.provider,
        waterQuality: waterQuality.provider,
        community: 'littora-reports',
      },
      disclaimer: 'Scores indicatifs. Ne remplacent jamais les consignes officielles, drapeaux, postes de secours, BMS ou autorités locales.',
    };
    const published = await this.cache.setJson(conditionKey(id), { ...projection, estimatedFlag:result.safety.estimatedFlag }, 900);
    if (requireProjection && !published) throw new Error('Search cache unavailable');
    return result;
  }

  safety(bathing: number | null, wave: number | null, current: number | null, uv: number | null, wind: number | null, quality?: string, communityAlerts: string[] = [], communityFlag?: any) {
    const estimatedFlag = quality === 'closed' ? 'unknown' : bathing === null || wave === null || current === null ? 'unknown'
      : bathing >= 78 && wave < 0.8 && current < 0.18 ? 'green' : bathing >= 55 && wave < 1.3 && current < 0.32 ? 'yellow' : 'red';
    return {
      flag: estimatedFlag,
      estimatedFlag,
      source: quality === 'closed' ? 'Interdiction officielle de baignade, indépendante du drapeau des sauveteurs.' : estimatedFlag === 'unknown' ? 'Conditions insuffisantes. Le drapeau officiel reste celui affiché sur place.'
          : 'Estimation Littora: météo, vagues, courant, UV, qualité d’eau et signalements. Le drapeau officiel reste celui affiché sur place.',
      official: false,
      communityFlag: communityFlag ?? null,
      alerts: [
        ...(uv !== null && uv >= 7 ? ['UV élevé'] : []),
        ...(wind !== null && wind >= 28 ? ['Vent soutenu'] : []),
        ...(wave !== null && wave >= 1.2 ? ['Mer agitée'] : []),
        ...(current !== null && current >= 0.28 ? ['Courant marqué'] : []),
        ...(quality === 'closed' ? ['Baignade interdite par décision officielle'] : quality === 'poor' ? ['Qualité d’eau défavorable au dernier prélèvement récent'] : ['Qualité sanitaire actuelle non confirmée']),
        ...(communityFlag ? [`Drapeaux signalés: ${communityFlag.counts.green} vert, ${communityFlag.counts.yellow} jaune, ${communityFlag.counts.red} rouge`] : []),
        ...(communityFlag?.recentRedAt ? [`Drapeau rouge observé le ${new Date(communityFlag.recentRedAt).toLocaleString('fr-FR',{timeZone:'Europe/Paris'})}. Signalement communautaire, non officiel.`] : []),
        ...communityAlerts,
      ],
    };
  }


  private series(hourly: Record<string, unknown[]> | undefined, key: string, now: number) {
    const hour = 3600_000;
    const first = Math.ceil(now / hour) * hour;
    const slots = new Map<number, {time:string; value:number|null}>();
    hourly?.time?.forEach((time, i) => {
      if (typeof time !== 'string') return;
      const slot = (Date.parse(time) - first) / hour;
      if (!Number.isInteger(slot) || slot < 0 || slot >= 8) return;
      const value = finiteMetric(hourly[key]?.[i]);
      const prior = slots.get(slot);
      if (!prior) slots.set(slot, {time, value});
      else if (prior.value !== value) prior.value = null;
    });
    return [...slots].sort(([a], [b]) => a - b).map(([,point]) => point);
  }

  private dataStatus(data: any) {
    return { status: data.status ?? 'unknown', kind: data.kind ?? null,
      fetchedAt: data.fetchedAt ?? null, validAt: data.validAt ?? null,
      ageSeconds: data.ageSeconds ?? null, producedAt: data.producedAt ?? null,
      nextCheckAt: data.nextCheckAt ?? null, collectionIntervalSeconds: data.collectionIntervalSeconds,
      units: data.units ?? {}, provider: data.provider, warning: data.warning ?? null };
  }

}
