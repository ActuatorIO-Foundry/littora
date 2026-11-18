import domains = require('./coastal-domains.json');

export const coastalDomains = domains;
const codes = new Set(domains.map(d => d.code));
export const bulletinUrl = 'https://vigilance.meteofrance.fr/fr/vagues-submersion';
export const cacheKey = 'official:vvs:v1';
export const freshnessMs = 10 * 60_000;

interface Slot { start: number; end: number; color: number }
export interface Bulletin { issued: number; fetched: number; zones: Record<string, Slot[]> }
export type Cached = { bulletin: Bulletin } | { reason: 'disabled' | 'unauthorized' | 'unavailable' | 'rate_limited' };

const time = (v: unknown) => typeof v === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(v) ? Date.parse(v) : NaN;
const fail = (): never => { throw new Error('Invalid vigilance bulletin'); };

export function parseBulletin(body: any, now: number): Bulletin {
  const p = body?.product, issued = time(p?.update_time);
  if (p?.warning_type !== 'vigilance' || p.type_cdp !== 'cdp_carte_externe' || p.domain_id !== 'FRA'
      || p.version_vigilance !== 'V6' || !Number.isFinite(issued) || issued > now || now-issued > 30*3600_000
      || !Array.isArray(p.periods)) return fail();
  const zones: Record<string, Slot[]> = {};
  const bad = new Set<string>();
  for (const period of p.periods) {
    if (!['J','J1'].includes(period?.echeance)) continue;
    const from = time(period.begin_validity_time), to = time(period.end_validity_time);
    if (!(from < to) || !Array.isArray(period.timelaps?.domain_ids)) return fail();
    for (const domain of period.timelaps.domain_ids) {
      const code = domain?.domain_id;
      if (!codes.has(code)) continue;
      const items = Array.isArray(domain.phenomenon_items)
        ? domain.phenomenon_items.filter((v:any) => v?.phenomenon_id === '9') : [];
      if (items.length !== 1 || !Array.isArray(items[0].timelaps_items)) { bad.add(code); continue; }
      for (const row of items[0].timelaps_items) {
        const start = Math.max(from,time(row?.begin_time)), end = Math.min(to,time(row?.end_time));
        if (!(start < end) || ![1,2,3,4].includes(row?.color_id)) { bad.add(code); break; }
        (zones[code] ??= []).push({ start, end, color: row.color_id });
      }
    }
  }
  for (const code of bad) delete zones[code];
  if (!Object.values(zones).some(slots => slots.some(s => s.start <= now && now < s.end))) return fail();
  return { issued, fetched: now, zones };
}

export function currentVigilance(cached: Cached | null, department?: string, now = Date.now()) {
  const base = { provider: 'meteofrance', product: 'vigilance-vagues-submersion', department,
    bulletinUrl, issuedAt: null as string | null, fetchedAt: null as string | null,
    validFrom: null as string | null, validUntil: null as string | null, checkBy: null as string | null };
  const unknown = (reason:string) => ({ ...base, status:'unknown', reason, alerts:[] as {level:string}[],
    warning:"Vigilance vagues-submersion indisponible pour cette zone." });
  if (!department || !codes.has(department+'10')) return unknown('zone_unknown');
  if (!cached || !('bulletin' in cached)) return unknown(cached?.reason ?? 'unavailable');
  const b = cached.bulletin, age = now-b?.fetched;
  if (!(age >= 0 && age < freshnessMs)) return unknown('expired');
  const slots = b.zones?.[department+'10']?.filter(s => s.start <= now && now < s.end);
  if (slots?.length !== 1) return unknown('no_valid_interval');
  const {start,end,color} = slots[0], level = ['','green','yellow','orange','red'][color];
  if (!level) return unknown('unavailable');
  const iso = (ms:number) => new Date(ms).toISOString();
  return { ...base, status:'available', reason:null, issuedAt:iso(b.issued), fetchedAt:iso(b.fetched),
    validFrom:iso(start),validUntil:iso(end), checkBy:iso(Math.min(end,b.fetched+freshnessMs)),
    alerts:color === 1 ? [] : [{level}], warning:'Vigilance du littoral départemental, pas un drapeau de baignade.' };
}
