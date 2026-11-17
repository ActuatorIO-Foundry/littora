import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Commune, CommuneCatalogue } from '../models/commune.model';
import { EMPTY, Observable, expand, reduce } from 'rxjs';
import { Beach, BeachAmenitiesResponse, BeachScore, ReportPayload } from '../models/beach.model';

@Injectable({
    providedIn: 'root'
})
export class LittoraApiService {
    private readonly apiUrl = this.resolveApiUrl();

    constructor(private readonly http: HttpClient) { }

    searchCommunes(query: string): Observable<Commune[]> {
        return this.http.get<Commune[]>(`${this.apiUrl}/places/communes`, { params: { q: query } });
    }

    getCommuneCatalogue(code: string): Observable<CommuneCatalogue> {
        return this.http.get<CommuneCatalogue>(`${this.apiUrl}/places/communes/${encodeURIComponent(code)}/beaches`);
    }

    getBeaches(limit = 180): Observable<Beach[]> {
        return this.http.get<Beach[]>(`${this.apiUrl}/beaches?limit=${limit}`);
    }

    getCatalogue(bbox?: string): Observable<Beach[]> {
        type Page = { beaches: Beach[]; nextCursor: string | null };
        const page = (after?: string) => this.http.get<Page>(`${this.apiUrl}/beaches/catalogue`, {
            params: { limit: '200', ...(after ? { after } : {}), ...(bbox ? { bbox } : {}) },
        });
        return page().pipe(
            expand((result) => result.nextCursor ? page(result.nextCursor) : EMPTY, 1),
            reduce((all, result) => all.concat(result.beaches), [] as Beach[]),
        );
    }

    discoverBeaches(zone: { bbox: string; name: string; coastline: string }): Observable<{ provider: string; imported: number; warning?: string; beaches: Beach[] }> {
        return this.http.get<{ provider: string; imported: number; warning?: string; beaches: Beach[] }>(
            `${this.apiUrl}/beaches/discover?bbox=${zone.bbox}&region=${encodeURIComponent(zone.name)}&coastline=${encodeURIComponent(zone.coastline)}&limit=140`
        );
    }

    getBeach(beachId: string): Observable<Beach> {
        return this.http.get<Beach>(`${this.apiUrl}/beaches/${beachId}`);
    }

    getBeachAmenities(beachId: string): Observable<BeachAmenitiesResponse> {
        return this.http.get<BeachAmenitiesResponse>(`${this.apiUrl}/beaches/${beachId}/amenities`);
    }

    getScore(beachId: string): Observable<BeachScore> {
        return this.http.get<BeachScore>(`${this.apiUrl}/score/beach/${beachId}`);
    }

    getRecommendations(lat: number, lon: number, usage = 'bathing'): Observable<Array<Beach & { selectedScore?: number; scores?: BeachScore['scores'] }>> {
        return this.http.get<Array<Beach & { selectedScore?: number; scores?: BeachScore['scores'] }>>(
            `${this.apiUrl}/recommendations?lat=${lat}&lon=${lon}&usage=${usage}`
        );
    }

    createReport(payload: ReportPayload): Observable<unknown> {
        return this.http.post(`${this.apiUrl}/reports`, payload);
    }

    getReports(beachId: string): Observable<unknown[]> {
        return this.http.get<unknown[]>(`${this.apiUrl}/reports?beachId=${beachId}`);
    }

    private resolveApiUrl(): string {
        const { protocol, hostname, port } = window.location;
        if ((hostname === 'localhost' || hostname === '127.0.0.1') && port === '4200') {
            return '/api';
        }
        return '/api';
    }
}
