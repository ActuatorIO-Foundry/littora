import { Component, Input } from '@angular/core';
import type { DataStatus } from '../models/beach.model';
import { forecastIsStale } from './presentation';

const decimal = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

@Component({
  selector: 'app-metric-reading',
  standalone: true,
  template: `
    @if (formatted !== null) {
      <strong>{{ formatted }} <small>{{ unit }}</small></strong>
      @if (!status || status.status === 'unknown') { <small>Fraîcheur non renseignée</small> }
      @else if (stale(status)) { <small>Prévision périmée</small> }
    } @else {
      <small>Non renseigné</small>
    }
  `,
  styles: [`
    :host { display: grid; min-width: 0; overflow-wrap: anywhere; }
    strong { font-size: var(--reading-size, 20px); font-weight: 650; color: var(--metric-color, var(--ink)); }
    small { font-size: 12px; font-weight: 400; color: var(--muted); }
  `],
})
export class MetricReadingComponent {
  @Input({required: true}) value: unknown;
  @Input({required: true}) unit!: string;
  @Input() status?: DataStatus | null;
  readonly stale = forecastIsStale;
  get formatted(): string | null {
    return typeof this.value === 'number' && Number.isFinite(this.value) ? decimal.format(this.value) : null;
  }
}
