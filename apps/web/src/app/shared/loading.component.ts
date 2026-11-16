import { Component, Input } from "@angular/core";
@Component({
  selector: "app-loading",
  standalone: true,
  template: `<div class="loading" role="status">
    <div class="tide" aria-hidden="true"><i></i><i></i><i></i></div>
    <span>{{ label }}</span>
  </div>`,
  styles: [
    `
      .loading {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 14px;
        min-height: 130px;
        color: var(--muted);
        font-size: 13px;
      }
      .tide {
        display: flex;
        align-items: center;
        gap: 4px;
        height: 30px;
      }
      .tide i {
        width: 5px;
        height: 14px;
        border-radius: 4px;
        background: var(--sea);
        animation: tide 1.2s ease-in-out infinite;
      }
      .tide i:nth-child(2) {
        animation-delay: 0.15s;
      }
      .tide i:nth-child(3) {
        animation-delay: 0.3s;
      }
      @keyframes tide {
        50% {
          transform: scaleY(1.8);
          opacity: 0.4;
        }
      }
    `,
  ],
})
export class LoadingComponent {
  @Input() label = "Chargement des conditions…";
}
