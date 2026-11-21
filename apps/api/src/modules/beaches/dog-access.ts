// Scope is a reviewed catalogue feature, never a place name, radius or whole municipality.
type Rule = {
  sites: readonly string[];
  status: 'allowed' | 'conditional' | 'prohibited';
  detail: string;
  source: string;
  sourceUrl: string;
  checkedOn: string;
  reviewBy: string;
  validUntil?: string;
  closedSeason?: readonly [string, string]; // MM-DD, inclusive in mainland France
};
const review = { checkedOn: '2026-11-21', reviewBy: '2027-11-20' };
const rules: readonly Rule[] = [
  { ...review, sites: ['way/961374583'], status: 'allowed', source: 'Ville de Nice',
    sourceUrl: 'https://www.nice.fr/avoir-un-chien-en-ville/',
    detail: 'Accès toute l’année sur la plage canine de Lenval, face aux numéros 137 à 147 de la promenade des Anglais.' },
  { ...review, sites: ['way/30585237'], status: 'conditional', source: 'Golfe de Saint-Tropez Tourisme',
    sourceUrl: 'https://www.golfe-saint-tropez-information.com/fr/loisirs/autres-loisirs/ramatuelle/plage-de-l-escalet-4600952',
    detail: 'À l’Escalet, la laisse est obligatoire toute l’année.' },
  { ...review, sites: ['way/197492653', 'way/167688426', 'way/291977817'], status: 'conditional',
    source: 'Dinard Émeraude Tourisme',
    sourceUrl: 'https://www.dinardemeraudetourisme.com/experiences/en-amoureux/plages-autorisees-aux-chiens-sur-la-cote-demeraude/',
    closedSeason: ['06-15', '09-15'],
    detail: 'Accès du 16 septembre au 14 juin. Les chiens sont interdits du 15 juin au 15 septembre inclus.' },
  { ...review, sites: ['way/161971394', 'way/77594385', 'way/166482963', 'way/138422227',
      'way/166482964', 'way/138422434', 'way/208693407', 'way/227845072'], status: 'prohibited',
    source: 'Bandol Tourisme', sourceUrl: 'https://www.bandoltourisme.fr/bandol/la-destination/les-plages/',
    detail: 'Chiens de compagnie interdits sur cette plage. À Bandol, la Dog Beach située près du stade Deferrari est un site distinct.' },
];
const paris = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
export const dogRuleDay = (now: Date) => paris.format(now);
export type DogAccessFilter = 'welcome' | 'allowed';

export function dogAccess(site: string | null, now = new Date(), records = rules) {
  const matched = site ? records.filter(rule => rule.sites.includes(site)) : [];
  if (!matched.length) return { status: 'unknown', reason: 'unlisted' };
  const day = dogRuleDay(now);
  const active = matched.filter(r => r.checkedOn <= day && day <= r.reviewBy && (!r.validUntil || day <= r.validUntil));
  if (active.length !== 1) return { status: 'unknown', reason: active.length ? 'conflict' : 'outdated' };
  const { status, detail, source, sourceUrl, checkedOn, validUntil, closedSeason } = active[0];
  const md = day.slice(5);
  const closed = closedSeason && (closedSeason[0] <= closedSeason[1]
    ? md >= closedSeason[0] && md <= closedSeason[1] : md >= closedSeason[0] || md <= closedSeason[1]);
  return { status: closed ? 'prohibited' : status, detail, source, sourceUrl, checkedOn, ...(validUntil ? { validUntil } : {}) };
}

export function dogFriendlySites(filter: DogAccessFilter, at: Date) {
  return [...new Set(rules.flatMap(rule => rule.sites))].filter(site => {
    const { status } = dogAccess(site, at);
    return status === 'allowed' || (filter === 'welcome' && status === 'conditional');
  });
}
