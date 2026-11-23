import { DatePipe } from '@angular/common';
import { Component, HostListener, Input, OnDestroy, signal } from '@angular/core';
import type { OfficialFlagBulletin } from '@littora/api-client/models';
import { IconComponent } from './icon.component';

@Component({
  selector: 'app-flag-bulletin', standalone: true, imports: [DatePipe, IconComponent],
  template: `
    <h3>Bulletin des sauveteurs</h3>
    <p>{{ bulletin.zone }} · {{ bulletin.publisher }}</p>
    <p class="caption">Mise à jour quotidienne en haute saison. Littora ne confirme ni la couleur ni sa durée de validité. Les consignes sur place prévalent.</p>
    @if (bulletin.provider === 'plages-landes' && bulletin.widgetId === 560) {
      <button class="btn" type="button" (click)="toggle()" [attr.aria-expanded]="open()">
        <app-icon name="flag" [size]="16" />{{ open() ? 'Masquer le bulletin' : 'Afficher le bulletin de Plages Landes' }}
      </button>
      @if (open()) {
        <iframe title="Bulletin Plages Landes : plage de la Piste à Capbreton"
          src="https://www.plages-landes.info/widget-plages-des-landes/?plgs=560&amp;cprimary=1ea7ce&amp;csecondary=ffffff&amp;picto="
          sandbox="allow-scripts allow-same-origin" referrerpolicy="no-referrer" width="300" height="600"></iframe>
      }
    }
    <p><a [href]="bulletin.sourceUrl" target="_blank" rel="noopener noreferrer">Consulter directement Plages Landes</a></p>
    <p class="caption">Lien avec la plage vérifié le {{ bulletin.linkVerifiedOn | date:'dd/MM/yyyy':'UTC' }}.</p>
  `,
  styles: [`:host { display: block; margin: 1rem 0; } p { margin: .4rem 0; }
    button { margin: .45rem 0; } iframe { display: block; max-width: 100%; border: 1px solid var(--line); }`],
})
export class FlagBulletinComponent implements OnDestroy {
  @Input({required:true}) bulletin!: OfficialFlagBulletin;
  readonly open = signal(false);
  private timer?: ReturnType<typeof setTimeout>;
  toggle(): void {
    if (this.open()) return this.close();
    this.open.set(true);
    // Limit the lifetime of an open external document, not the validity of its flag.
    this.timer = setTimeout(() => this.close(), 5 * 60_000);
  }
  @HostListener('document:visibilitychange')
  onVisibilityChange(): void { if (document.hidden) this.close(); }
  private close(): void {
    clearTimeout(this.timer);
    this.open.set(false);
  }
  ngOnDestroy(): void { clearTimeout(this.timer); }
}
