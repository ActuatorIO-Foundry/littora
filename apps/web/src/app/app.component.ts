import { Component, HostListener, inject } from "@angular/core";
import { CommonModule } from "@angular/common";
import { toSignal } from "@angular/core/rxjs-interop";
import { filter, map } from "rxjs";
import { IconComponent } from "./shared/icon.component";
import {
  NavigationEnd,
  PRIMARY_OUTLET,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from "@angular/router";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    IconComponent,
  ],
  templateUrl: "./app.component.html",
  styleUrl: "./app.component.css",
})
export class AppComponent {
  private readonly router = inject(Router);
  readonly secondaryPage = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) =>
        Boolean(
          this.router.parseUrl(event.urlAfterRedirects).root.children[
            PRIMARY_OUTLET
          ]?.segments.length,
        ),
      ),
    ),
    { initialValue: false },
  );
  coastPaused = false;
  pageHidden = document.hidden;
  menuOpen = false;

  @HostListener("document:visibilitychange")
  updateVisibility(): void {
    this.pageHidden = document.hidden;
  }

  skipToContent(event: Event): void {
    event.preventDefault();
    const main = document.getElementById("main-content");
    main?.focus({ preventScroll: true });
    main?.scrollIntoView({ block: "start" });
  }
}
