import { Injectable } from '@nestjs/common';
import { CacheService } from '../../cache/cache.service';
import { matchPort } from './shom-ports';
import { PortCache, references, shomKey } from './shom-reference';

export function unavailableTides() {
  return {provider:'unknown',status:'unknown',reliability:'unknown',fetchedAt:null,validAt:null,
    ageSeconds:null,harbor:null,events:[],portReference:null,heightReference:null,currentReference:null,
    warning:'Pas de données de marée pour ce site. Ne pas utiliser pour la navigation.'};
}

@Injectable()
export class TidesService {
  constructor(private readonly cache:CacheService) {}

  async get(lat:number,lon:number,harbor?:string) {
    const match=matchPort(lat,lon,harbor);
    if (!match) return unavailableTides();
    const {port,distanceKm}=match;
    const record=await this.cache.getJson<PortCache>(shomKey(port));
    return {...unavailableTides(),provider:'shom',harbor:port.name,
      portReference:{name:port.name,lat:port.lat,lon:port.lon,distanceKm,
        timetableUrl:'https://maree.shom.fr/harbor/'+port.slug+'/'},
      ...references(record,port),
      warning:'Références au port uniquement. Horaires et coefficients à consulter chez le Shom. Ni observation actuelle ni aide à la navigation.'};
  }
}
