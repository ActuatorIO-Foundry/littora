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
      Score indisponible · {{ e.available }}/{{ e.required }} mesures utilisables.
    </p>
    <p *ngSwitchCase="'partial'">
      Indice partiel : <strong>au plus {{ e.partialScore }}/100</strong> · {{ e.available }}/{{ e.required }} mesures utilisables.
      Les autres mesures pourraient abaisser cet indice.
    </p>
    <ng-container *ngSwitchCase="'calculated'">
      <p>
        Confort : <strong>{{ e.score }}/100</strong> · {{ e.available }}/{{ e.required }} mesures.
      </p>
    </ng-container>
    <p class="caption" *ngIf="e.status === 'calculated' || e.status === 'partial'">
      Base : 100<span *ngFor="let factor of e.factors"> · {{ factor.label }} : {{ factor.points }}</span>.
    </p>
    <p class="caption" *ngIf="e.stale?.length">Prévisions périmées, exclues du calcul : {{ e.stale.join(', ') }}.</p>
    <p class="caption" *ngIf="e.invalid?.length">Valeur, unité ou datation non exploitable : {{ e.invalid.join(', ') }}.</p>
    <p class="caption" *ngIf="e.missing.length">Non renseigné : {{ e.missing.join(', ') }}.</p>
  </ng-container>`,
})
export class ComfortExplanationComponent {
  @Input() value?: ScoreExplanation;
}
