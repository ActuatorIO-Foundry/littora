import { DatePipe } from '@angular/common';
import { Component, Input } from '@angular/core';
import type { Naturism } from '@littora/api-client/models';
import { IconComponent } from './icon.component';

@Component({
  selector: 'app-naturism', standalone: true, imports: [DatePipe, IconComponent],
  template: `
    @if (detailed) { <h3>Naturisme</h3> }
    @if (info && info.status !== 'unknown') {
      <span class="naturism-label"><app-icon name="sun" [size]="15" aria-hidden="true" />
        {{ info.status === 'dedicated' ? 'Plage naturiste' : 'Secteur naturiste' }}</span>
      @if (detailed) {
        <p>{{ info.detail }}</p>
        <small><a [href]="info.sourceUrl" target="_blank" rel="noopener noreferrer">{{ info.source }}</a>
          · Vérifié le {{ info.checkedOn + 'T00:00:00Z' | date:'dd/MM/yyyy':'UTC' }}</small>
      }
    } @else if (detailed) { <p>Aucune information vérifiée sur la pratique du naturisme pour cette plage.</p> }
  `,
  styles: [`
    :host { min-width: 0; max-width: 100%; }
    :host(.on-site) { display: block; margin: 1.25rem 0; }
    h3 { margin: 0 0 .6rem; }
    .naturism-label { display: inline-flex; align-items: center; gap: .32rem; padding: .15rem .42rem;
      max-width: 100%; border-radius: 4px; font-weight: 650; font-size: .8rem; line-height: 1.4;
      color: #365b47; background: #eaf3e9; }
    p { margin: .45rem 0; } small { color: var(--muted); }
  `],
})
export class NaturismComponent {
  @Input() info?: Naturism;
  @Input() detailed = false;
}
