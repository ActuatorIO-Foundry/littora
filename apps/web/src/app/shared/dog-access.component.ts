import { DatePipe } from '@angular/common';
import { Component, Input } from '@angular/core';
import type { DogAccess } from '@littora/api-client/models';
import { IconComponent } from './icon.component';

@Component({
  selector: 'app-dog-access',
  standalone: true,
  imports: [DatePipe, IconComponent],
  template: `
    @if (detailed) { <h3>Venir avec son chien</h3> }
    @if (access && access.status !== 'unknown') {
      <span class="dog-label" [attr.data-status]="access.status">
        <app-icon name="paw" [size]="15" aria-hidden="true" />{{ labels[access.status] }}
      </span>
      @if (detailed) {
        <p>{{ access.detail }}</p>
        <small><a [href]="access.sourceUrl" target="_blank" rel="noopener noreferrer">{{ access.source }}</a>
          · Vérifié le {{ access.checkedOn + 'T00:00:00Z' | date:'dd/MM/yyyy':'UTC' }}
          @if (access.validUntil) { · Valable jusqu’au {{ access.validUntil + 'T00:00:00Z' | date:'dd/MM/yyyy':'UTC' }} }
        </small>
      }
    } @else if (detailed) {
      <p>Non renseigné.@if (access?.reason === 'conflict') { Les sources se contredisent. }
        @if (access?.reason === 'outdated') { La règle doit être vérifiée à nouveau. }
        Renseignez-vous auprès du gestionnaire de la plage.</p>
    }
  `,
  styles: [`
    :host { min-width: 0; max-width: 100%; }
    :host(.on-site) { display: block; margin: 1.25rem 0; }
    h3 { margin: 0 0 .6rem; }
    .dog-label { display: inline-flex; align-items: center; gap: .32rem; padding: .15rem .42rem;
      max-width: 100%; border-radius: 4px; font-weight: 650; font-size: .8rem; line-height: 1.4;
      background: var(--aqua); color: var(--sea-dark); }
    .dog-label[data-status="conditional"] { color: #684e23; background: #f6f1e5; }
    .dog-label[data-status="prohibited"] { color: #46555a; background: #eef1f1; }
    p { margin: .45rem 0; } small { color: var(--muted); }
  `],
})
export class DogAccessComponent {
  @Input() access?: DogAccess;
  @Input() detailed = false;
  readonly labels = { allowed: 'Chiens admis', conditional: 'Chiens admis sous conditions', prohibited: 'Chiens de compagnie interdits' };
}
