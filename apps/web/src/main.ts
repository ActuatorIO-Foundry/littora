import { bootstrapApplication } from "@angular/platform-browser";
import { provideHttpClient } from "@angular/common/http";
import { provideRouter, Routes, withInMemoryScrolling } from "@angular/router";
import { AppComponent } from "./app/app.component";

const routes: Routes = [
  {
    path: "",
    title: "Littora · La mer commence ici",
    loadComponent: () =>
      import("./app/pages/home/home.component").then((m) => m.HomeComponent),
  },
  {
    path: "recherche",
    title: "Explorer les plages · Littora",
    loadComponent: () =>
      import("./app/pages/search/search.component").then(
        (m) => m.SearchComponent,
      ),
  },
  {
    path: "bareme",
    title: "Le barème des indices · Littora",
    loadComponent: () => import("./app/pages/bareme/bareme.component").then(m => m.BaremeComponent),
  },
  {
    path: "contact",
    title: "Contact · Littora",
    loadComponent: () =>
      import("./app/pages/contact/contact.component").then(
        (m) => m.ContactComponent,
      ),
  },
  {
    path: "plages/:id",
    title: "Conditions de la plage · Littora",
    loadComponent: () =>
      import("./app/pages/beach-detail/beach-detail.component").then(
        (m) => m.BeachDetailComponent,
      ),
  },
  { path: "**", redirectTo: "" },
];
bootstrapApplication(AppComponent, {
  providers: [
    provideHttpClient(),
    provideRouter(
      routes,
      withInMemoryScrolling({
        scrollPositionRestoration: "enabled",
        anchorScrolling: "enabled",
      }),
    ),
  ],
}).catch(console.error);
