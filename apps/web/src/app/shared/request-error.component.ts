import { Component, Input } from '@angular/core';
import { IconComponent } from './icon.component';

@Component({
  selector: '[appRequestError]',
  standalone: true,
  imports: [IconComponent],
  host: { class: 'notice error', role: 'alert' },
  template: `<app-icon name="alert" [size]="18" /><span>{{ appRequestError }}</span><ng-content />`,
})
export class RequestErrorComponent {
  @Input({required: true}) appRequestError!: string;
}
