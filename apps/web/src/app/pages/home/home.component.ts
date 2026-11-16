import { CommonModule } from "@angular/common";
import { Component } from "@angular/core";
import { RouterLink, Router } from "@angular/router";
import { FormsModule } from "@angular/forms";
import { CoastMapComponent } from "../../shared/coast-map.component";
import { OceanSceneComponent } from "../../shared/ocean-scene.component";
import { IconComponent } from "../../shared/icon.component";
import { RevealDirective } from "../../shared/reveal.directive";
import { COASTAL_ZONES, CoastalZone } from "../../shared/coastal-zones";
@Component({
  selector: "app-home",
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    FormsModule,
    CoastMapComponent,
    OceanSceneComponent,
    IconComponent,
    RevealDirective,
  ],
  templateUrl: "./home.component.html",
  styleUrl: "./home.component.css",
})
export class HomeComponent {
  readonly zones = COASTAL_ZONES;
  query = "";
  readonly usages = [
    {
      id: "bathing",
      icon: "bathing",
      name: "Une envie de baignade",
      text: "L’eau, les vagues et les conditions du moment.",
    },
    {
      id: "family",
      icon: "family",
      name: "Une journée en famille",
      text: "Des accès pratiques et des équipements à proximité.",
    },
    {
      id: "paddle",
      icon: "wind",
      name: "L’appel du large",
      text: "Vent et houle pour vos sports nautiques.",
    },
    {
      id: "boat",
      icon: "boat",
      name: "Une sortie en bateau",
      text: "Un regard sur les conditions de la côte.",
    },
  ];
  constructor(private readonly router: Router) {}
  explore(zone: CoastalZone): void {
    void this.router.navigate(["/recherche"], {
      queryParams: { zone: zone.id },
    });
  }
  search(): void {
    void this.router.navigate(["/recherche"], {
      queryParams: { q: this.query || null },
    });
  }
}
