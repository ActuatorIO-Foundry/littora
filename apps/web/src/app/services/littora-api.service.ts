import { Injectable } from '@angular/core';
import { LittoraService } from '@littora/api-client';
import type { Beach as ApiBeach, Commune as ApiCommune } from '@littora/api-client/models';
import { Commune, CommuneCatalogue } from '../models/commune.model';
import { EMPTY, Observable, expand, map, reduce } from 'rxjs';
import { Beach, BeachAmenitiesResponse, BeachScore, ReportPayload } from '../models/beach.model';

// Preserve display models while the wire contract makes unknown values explicit.
const beachView = (beach: ApiBeach): Beach => ({ ...beach, city: beach.city ?? '',
    department: beach.department ?? '', region: beach.region ?? '', coastline: beach.coastline ?? '' });
const communeView = (commune: ApiCommune): Commune => ({ ...commune,
    bbox: [commune.bbox[0], commune.bbox[1], commune.bbox[2], commune.bbox[3]] });

@Injectable({
    providedIn: 'root'
})
export class LittoraApiService {
    constructor(private readonly client: LittoraService) { }

    searchCommunes(query: string): Observable<Commune[]> {
        return this.client.searchCommunes({ q: query }).pipe(map(rows => rows.map(communeView)));
    }

    getCommuneCatalogue(code: string): Observable<CommuneCatalogue> {
        return this.client.getCommuneCatalogue({ code }).pipe(map(result => ({ ...result,
            commune: communeView(result.commune), beaches: result.beaches.map(beachView) })));
    }

    getBeaches(limit = 180): Observable<Beach[]> {
        return this.client.listBeaches({ limit }).pipe(map(rows => rows.map(beachView)));
    }

    getCatalogue(bbox?: string): Observable<Beach[]> {
        const page = (after?: string) => this.client.getCatalogue({ limit: 200, after, bbox });
        return page().pipe(
            expand(result => (result.pageInfo?.nextCursor ?? result.nextCursor)
                ? page(result.pageInfo?.nextCursor ?? result.nextCursor ?? undefined) : EMPTY, 1),
            reduce((all, result) => all.concat((result.items ?? result.beaches).map(beachView)), [] as Beach[]),
        );
    }

    discoverBeaches(zone: { bbox: string; name: string; coastline: string }): Observable<{ provider: string; imported: number; warning?: string; beaches: Beach[] }> {
        return this.client.discoverBeaches({ bbox: zone.bbox, region: zone.name, coastline: zone.coastline, limit: 140 })
            .pipe(map(result => ({ ...result, beaches: result.beaches.map(beachView) })));
    }

    getBeach(beachId: string): Observable<Beach> {
        return this.client.getBeach({ id: beachId }).pipe(map(beachView));
    }

    getBeachAmenities(beachId: string): Observable<BeachAmenitiesResponse> {
        return this.client.getBeachAmenities({ id: beachId });
    }

    getScore(beachId: string): Observable<BeachScore> {
        return this.client.getBeachScore({ id: beachId }).pipe(map(result => ({ ...result, beach: beachView(result.beach),
            current: { ...result.current, tides: { ...result.current.tides }, waterQuality: { ...result.current.waterQuality } } })));
    }

    getRecommendations(lat: number, lon: number, usage = 'bathing'): Observable<Array<Beach & { selectedScore: number | null; scores: BeachScore['scores'] }>> {
        const selectedUsage = (['bathing', 'family', 'paddle', 'boat'] as const).find(item => item === usage) ?? 'bathing';
        return this.client.getRecommendations({ lat, lon, usage: selectedUsage }).pipe(map(rows => rows.map(row => ({
            ...beachView(row), selectedScore: row.selectedScore, scores: row.scores,
        }))));
    }

    createReport(payload: ReportPayload): Observable<unknown> {
        return this.client.createReport({ body: payload });
    }

    getReports(beachId: string): Observable<unknown[]> {
        return this.client.getReports({ beachId });
    }
}
