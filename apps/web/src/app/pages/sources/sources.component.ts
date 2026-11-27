import {Component} from '@angular/core';
import {RouterLink} from '@angular/router';

@Component({
  standalone: true,
  imports: [RouterLink],
  templateUrl: './sources.component.html',
  styles: [`
    article { max-width: 52rem; margin: 0 auto; padding: 3rem 1.25rem 5rem; }
    h1 { font-size: 2.4rem; line-height: 1.15; }
    h2 { font-size: 1.4rem; margin: 2rem 0 .5rem; }
    p { line-height: 1.6; }
    a { text-decoration: underline; text-underline-offset: .15em; }
  `],
})
export class SourcesComponent {}
