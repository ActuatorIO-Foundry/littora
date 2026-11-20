import type { Source } from '../shared/forecast-data';

const tasks = ['collect', 'project', 'vigilance', 'shom', 'score-coverage', 'import'] as const;
type Task = typeof tasks[number];
type Provider = Source | 'meteo-france-vigilance' | 'shom';
type Reason = 'rate_limited' | 'unauthorized' | 'unavailable' | 'timeout' | 'invalid_data' | 'failed';
type Signal = { event: 'provider_failure'; component: Provider; reason: Reason }
  | { event: 'job_failure'; component: Task | 'unknown'; reason: 'failed' }
  | { event: 'worker_failure'; component: 'weather_queue' | 'ars_queue' | 'score_cache' | 'startup'; reason: 'unavailable' };

export class ForecastCollectionFailure extends Error {
  readonly reason: Reason;
  constructor(readonly source: Source, code: string) {
    super('Forecast collection failed');
    this.reason = code === 'http_429' ? 'rate_limited' : ['http_401', 'http_403'].includes(code) ? 'unauthorized'
      : code === 'timeout' ? 'timeout' : code === 'empty' ? 'invalid_data' : 'unavailable';
  }
}

export class CollectionSignals {
  private readonly last = new Map<string, number>();
  constructor(private readonly emit = (line: string) => console.error(line), private readonly now = Date.now) {}

  private publish(signal: Signal) {
    const key = [signal.event, signal.component, signal.reason].join(':');
    const time = this.now(), previous = this.last.get(key);
    if (previous !== undefined && time >= previous && time - previous < 300_000) return;
    this.last.set(key, time);
    this.emit(JSON.stringify({ at: new Date(time).toISOString(), ...signal }));
  }
  workerFailure(component: 'weather_queue' | 'ars_queue' | 'score_cache' | 'startup') {
    this.publish({ event: 'worker_failure', component, reason: 'unavailable' });
  }
  jobFailure(name?: string) {
    this.publish({ event: 'job_failure', component: tasks.find(task => task === name) ?? 'unknown', reason: 'failed' });
  }

  async run<T>(name: string, operation: () => Promise<T>): Promise<T> {
    try {
      const result = await operation();
      if (name === 'vigilance' && (result === 'rate_limited' || result === 'unauthorized' || result === 'unavailable'))
        this.publish({ event: 'provider_failure', component: 'meteo-france-vigilance', reason: result as Reason });
      if (name === 'shom' && result === 'unavailable')
        this.publish({ event: 'provider_failure', component: 'shom', reason: 'unavailable' });
      return result;
    } catch (error) {
      if (error instanceof ForecastCollectionFailure && (error.source === 'open-meteo' || error.source === 'open-meteo-marine'))
        this.publish({ event: 'provider_failure', component: error.source, reason: error.reason });
      // BullMQ retains the thrown message and stack. Never hand it a raw provider or database error.
      throw new Error('Collection job failed');
    }
  }
}
