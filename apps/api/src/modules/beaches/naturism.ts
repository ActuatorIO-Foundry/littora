import { beachRuleDay } from './beach-rule-day';

type Scope = 'dedicated' | 'section';
export type NaturismFilter = 'verified' | Scope;
type Rule = { status: Scope; detail: string; source: string; sourceUrl: string; checkedOn: string; reviewBy: string };
const review = { checkedOn: '2026-11-21', reviewBy: '2027-11-20' };
// Match a reviewed catalogue feature, never its name or its neighbours.
const sites: Readonly<Record<string, Rule | undefined>> = {
  'way/25661665': { ...review, status: 'dedicated', source: 'Office de tourisme Cap d’Agde Méditerranée',
    sourceUrl: 'https://www.capdagde.com/otca-experience/le-naturisme-au-cap-dagde/',
    detail: 'Il s’agit de la plage du village naturiste. L’accès par le village est réglementé.' },
  'relation/13587236': { ...review, status: 'section', source: 'Ville d’Arles',
    sourceUrl: 'https://arles.fr/vivre-a-arles/faire-du-sport/les-equipements-de-loisirs/plage/piemanson-la-plage-darles-100-nature/',
    detail: 'À Piémanson, seul le secteur signalé sur place est naturiste.' },
  'way/955256383': { ...review, status: 'section', source: 'Ville d’Erquy',
    sourceUrl: 'https://www.ville-erquy.com/wp-content/uploads/2023/06/2023-06-30-reginea-express-n013-web.pdf',
    detail: 'Sur la plage de Lourtuais, le secteur naturiste se situe du côté du cap.' },
  'way/1055531744': { ...review, status: 'section', source: 'Ville de Berck-sur-Mer',
    sourceUrl: 'https://berck.fr/uploads/magazine_publication/magazine-juillet-2022-web-62bd75c11036a.pdf',
    detail: 'Le secteur commence à environ 600 m au nord de l’accès principal de la plage Nord et s’étend jusqu’à la limite de la commune.' },
  'way/154982461': { ...review, status: 'section', source: 'Tourisme Bretagne',
    sourceUrl: 'https://www.tourismebretagne.com/preparer-mon-sejour/bouger-visiter/toutes-les-activites/plage-de-keranouat-tregunc-fr-1994379/',
    detail: 'À Keranouat, les rochers marquent l’entrée du secteur naturiste.' },
};

export function naturismAt(site: string | null, at: Date) {
  const rule = site && Object.prototype.hasOwnProperty.call(sites, site) ? sites[site] : undefined;
  if (rule) {
    const day = beachRuleDay(at);
    const { reviewBy, ...info } = rule;
    if (rule.checkedOn <= day && day <= reviewBy) return info;
  }
  return { status: 'unknown' as const };
}

export function naturistSites(filter: NaturismFilter, at: Date) {
  return Object.keys(sites).filter(site => {
    const { status } = naturismAt(site, at);
    return status !== 'unknown' && (filter === 'verified' || status === filter);
  });
}
