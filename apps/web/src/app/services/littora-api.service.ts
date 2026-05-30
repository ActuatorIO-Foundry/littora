import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Beach, BeachAmenitiesResponse, BeachScore, ReportPayload } from '../models/beach.model';

@Injectable({
    providedIn: 'root'
})
export class LittoraApiService {
    private readonly apiUrl = this.resolveApiUrl();

    constructor(private readonly http: HttpClient) { }

    getBeaches(limit = 180): Observable<Beach[]> {
        return this.http.get<Beach[]>(`${this.apiUrl}/beaches?limit=${limit}`);
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
