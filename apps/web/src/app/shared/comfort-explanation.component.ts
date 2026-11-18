import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import type { ScoreExplanation } from '@littora/api-client/models';

@Component({
  selector: 'app-comfort-explanation',
  standalone: true,
  imports: [CommonModule],
  template: `<ng-container *ngIf="value as e" [ngSwitch]="e.status">
    <p *ngSwitchCase="'closed'">
      Baignade interdite par décision officielle. Note : 0/100, indépendamment des prévisions.
    </p>
    <p *ngSwitchCase="'not-applicable'">Pas de score : ce modèle concerne uniquement le milieu marin.</p>
    <p *ngSwitchCase="'insufficient'">
      Score indisponible · {{ e.available }}/{{ e.required }} mesures utilisables. Manque :
      {{ e.missing.join(', ') }}.
    </p>
    <ng-container *ngSwitchCase="'calculated'">
      <p>
        Confort : <strong>{{ e.score }}/100</strong> · {{ e.available }}/{{ e.required }} mesures.
      </p>
      <p class="caption">
        Base : 100<span *ngFor="let factor of e.factors"> · {{ factor.label }} : {{ factor.points }}</span
        >.
      </p>
    </ng-container>
  </ng-container>`,
})
export class ComfortExplanationComponent {
  @Input() value?: ScoreExplanation;
}
