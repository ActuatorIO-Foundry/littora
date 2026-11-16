import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';

@Component({
    selector: 'app-home',
    standalone: true,
    imports: [CommonModule, RouterLink],
    templateUrl: './home.component.html',
    styleUrl: './home.component.css'
})
export class HomeComponent {
    readonly mapUrl: SafeResourceUrl;
    readonly observationCards = [
        { label: 'Vent littoral', value: '8-30 km/h', state: 'variable', level: 'green' },
        { label: 'UV après-midi', value: '6-8', state: 'protection nécessaire', level: 'orange' },
        { label: 'Mer Méditerranée', value: '0.1-0.8 m', state: 'localement calme', level: 'green' },
        { label: 'Qualité baignade', value: 'ARS à brancher', state: 'source officielle prévue', level: 'blue' }
    ];

    readonly useCases = [
        'Vacanciers qui veulent choisir avant de partir',
        'Familles qui cherchent une plage pratique et surveillée',
        'Sports nautiques qui surveillent vent, houle et courant',
        'Plaisanciers qui préparent une sortie côtière'
    ];

    constructor(private readonly sanitizer: DomSanitizer) {
        this.mapUrl = this.sanitizer.bypassSecurityTrustResourceUrl(
            'https://www.openstreetmap.org/export/embed.html?bbox=-6.5,41.0,10.5,51.5&layer=mapnik'
        );
    }
}
