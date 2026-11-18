import { Injectable } from '@angular/core';
import { LittoraService } from '@littora/api-client';
import type { Beach as ApiBeach, BeachSearch, Commune as ApiCommune, ContributionSession, SearchPage } from '@littora/api-client/models';
import { Commune, CommuneCatalogue } from '../models/commune.model';
import { EMPTY, Observable, catchError, expand, finalize, map, of, reduce, shareReplay, switchMap, tap, throwError } from 'rxjs';
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
    private contributionSession?: ContributionSession;
    private pendingSession?: Observable<ContributionSession>;

    private session(): Observable<ContributionSession> {
        if (!this.contributionSession) {
            try { this.contributionSession = JSON.parse(localStorage.getItem('littora.contribution') ?? 'null') ?? undefined; } catch { }
        }
        const saved = this.contributionSession;
        if (saved && /^[a-f0-9]{64}$/.test(saved.token) && Date.parse(saved.expiresAt) > Date.now() + 60000) return of(saved);
        if (!this.pendingSession) {
            this.pendingSession = this.client.createContributionSession().pipe(
                tap(session => {
                    this.contributionSession = session;
                    try { localStorage.setItem('littora.contribution', JSON.stringify(session)); } catch { }
                }),
                finalize(() => { this.pendingSession = undefined; }),
                shareReplay({bufferSize: 1, refCount: false}),
            );
        }
        return this.pendingSession;
    }

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

    searchBeaches(criteria: BeachSearch) {
        const page = (cursor?: string) => this.client.searchBeaches({ body: { ...criteria, limit: 200, ...(cursor ? { cursor } : {}) } });
        return page().pipe(
            expand(result => result.pageInfo.nextCursor ? page(result.pageInfo.nextCursor) : EMPTY, 1),
            reduce((all: SearchPage | null, result: SearchPage) => ({ ...result, items: [...(all?.items ?? []), ...result.items] }), null),
            map(result => {
                if (!result || result.items.length !== result.total || new Set(result.items.map(b => b.id)).size !== result.total) {
                    throw new Error('Incomplete search result');
                }
                return { ...result, commune: result.commune && 'code' in result.commune ? communeView(result.commune as ApiCommune) : null,
                    items: result.items.map(row => ({ ...beachView(row), ...row,
                        city: row.city ?? '', department: row.department ?? '', region: row.region ?? '', coastline: row.coastline ?? '' })) };
            }),
        );
    }


    getBeach(beachId: string): Observable<Beach> {
        return this.client.getBeach({ id: beachId }).pipe(map(beachView));
    }

    getVigilance(beachId: string) {
        return this.client.getAlerts({ beachId });
    }

    getBeachAmenities(beachId: string): Observable<BeachAmenitiesResponse> {
        return this.client.getBeachAmenities({ id: beachId });
    }

    getScore(beachId: string): Observable<BeachScore> {
        return this.client.getBeachScore({ id: beachId }).pipe(map(result => {
            if (result.beach.id.toLowerCase() !== beachId.toLowerCase()) throw new Error('Beach score identity mismatch');
            return { ...result, beach: beachView(result.beach),
                current: { ...result.current, tides: { ...result.current.tides }, waterQuality: { ...result.current.waterQuality } } };
        }));
    }

    getRecommendations(lat: number, lon: number, usage = 'bathing'): Observable<Array<Beach & { selectedScore: number | null; scores: BeachScore['scores'] }>> {
        const selectedUsage = (['bathing', 'family', 'paddle', 'boat'] as const).find(item => item === usage) ?? 'bathing';
        return this.client.getRecommendations({ lat, lon, usage: selectedUsage }).pipe(map(rows => rows.map(row => ({
            ...beachView(row), selectedScore: row.selectedScore, scores: row.scores,
        }))));
    }

    createReport(payload: ReportPayload): Observable<unknown> {
        return this.session().pipe(switchMap(session => this.client.createReport({
            body: payload, Authorization: `Bearer ${session.token}`,
        })), catchError(error => {
            if (error.status === 401) {
                this.contributionSession = undefined;
                try { localStorage.removeItem('littora.contribution'); } catch { }
            }
            return throwError(() => error);
        }));
    }

    getReports(beachId: string): Observable<unknown[]> {
        return this.client.getReports({ beachId });
    }
}
