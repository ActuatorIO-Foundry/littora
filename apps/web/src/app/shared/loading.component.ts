import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  NgZone,
  OnDestroy,
  ViewChild,
} from "@angular/core";
import { paintShoreWave } from "./shore-wave";

@Component({
  selector: "app-loading",
  standalone: true,
  template: `<div class="loading" role="status" aria-live="polite">
    <canvas
      #wave
      class="loading-wave"
      width="640"
      height="200"
      aria-hidden="true"
    ></canvas>
    <span>{{ label }}</span>
  </div>`,
  styles: [
    `
      :host {
        display: block;
      }
      .loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 10px;
        min-height: 166px;
        padding: 18px 12px;
        color: var(--muted);
        font-size: 13px;
        text-align: center;
      }
      .loading-wave {
        display: block;
        width: min(270px, 100%);
        aspect-ratio: 3.2;
        height: auto;
        mask-image:
          linear-gradient(
            to right,
            transparent,
            black 16%,
            black 84%,
            transparent
          ),
          linear-gradient(
            to bottom,
            transparent,
            black 22%,
            black 75%,
            transparent
          );
        mask-composite: intersect;
      }
      .loading span {
        max-width: 32ch;
      }
    `,
  ],
})
export class LoadingComponent implements AfterViewInit, OnDestroy {
  @Input() label = "Chargement des conditions…";
  @ViewChild("wave", { static: true }) wave!: ElementRef<HTMLCanvasElement>;
  private readonly motion = matchMedia("(prefers-reduced-motion: reduce)");
  private texture?: HTMLImageElement;
  private context: CanvasRenderingContext2D | null = null;
  private visibility?: IntersectionObserver;
  private frame = 0;
  private elapsed = 0;
  private lastFrame = 0;
  private visible = true;
  private destroyed = false;
  private readonly refreshMotion = () => this.updatePlayback();

  constructor(private readonly zone: NgZone) {}

  ngAfterViewInit(): void {
    this.zone.runOutsideAngular(() => {
      this.context = this.wave.nativeElement.getContext("2d");
      if (!this.context) return;
      this.draw();
      this.texture = new Image();
      this.texture.decoding = "async";
      this.texture.onload = () => {
        if (!this.destroyed) this.draw();
      };
      this.texture.src = "/images/lagune.jpg";
      this.motion.addEventListener("change", this.refreshMotion);
      document.addEventListener("visibilitychange", this.refreshMotion);
      this.visibility = new IntersectionObserver(([entry]) => {
        this.visible = entry.isIntersecting;
        this.updatePlayback();
      });
      this.visibility.observe(this.wave.nativeElement);
      this.updatePlayback();
    });
  }

  private draw(): void {
    if (this.context) paintShoreWave(this.context, this.texture, this.elapsed);
  }

  private updatePlayback(): void {
    cancelAnimationFrame(this.frame);
    if (this.destroyed) return;
    const running = !this.motion.matches && this.visible && !document.hidden;
    this.wave.nativeElement.dataset["motion"] = running ? "running" : "still";
    this.lastFrame = 0;
    if (this.motion.matches) {
      this.elapsed = 0;
      this.draw();
    }
    if (running) this.frame = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number): void => {
    if (this.destroyed) return;
    if (!this.lastFrame || now - this.lastFrame >= 1000 / 30) {
      this.elapsed += this.lastFrame
        ? Math.min((now - this.lastFrame) / 1000, 0.08)
        : 0;
      this.lastFrame = now;
      this.draw();
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  ngOnDestroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.frame);
    this.visibility?.disconnect();
    this.motion.removeEventListener("change", this.refreshMotion);
    document.removeEventListener("visibilitychange", this.refreshMotion);
    if (this.texture) this.texture.onload = null;
  }
}
