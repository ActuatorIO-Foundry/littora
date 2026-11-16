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
        width: 100%;
      }
      .loading {
        position: relative;
        isolation: isolate;
        min-height: 200px;
        margin-block: 18px;
        color: white;
        font-size: 15px;
        text-align: center;
        mask-image: linear-gradient(
          to bottom,
          transparent,
          black 8%,
          black 92%,
          transparent
        );
      }
      .loading::after {
        content: "";
        position: absolute;
        inset: 0;
        pointer-events: none;
        background: linear-gradient(
          to bottom,
          #041c2200,
          #041c22a8 32%,
          #041c22a8 68%,
          #041c2200
        );
      }
      .loading-wave {
        display: block;
        width: 100%;
        height: 200px;
      }
      .loading span {
        position: absolute;
        top: 50%;
        left: 50%;
        z-index: 1;
        transform: translate(-50%, -50%);
        width: calc(100% - 40px);
        max-width: 540px;
        line-height: 1.55;
        font-weight: 600;
        text-shadow: 0 1px 4px #041c2280;
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
  private resize?: ResizeObserver;
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
      this.resize = new ResizeObserver(() => {
        const canvas = this.wave.nativeElement;
        if (!canvas.clientWidth) return;
        const width = Math.round(canvas.clientWidth * 2);
        const height = Math.round(canvas.clientHeight * 2);
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
          this.draw();
        }
      });
      this.resize.observe(this.wave.nativeElement);
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
    this.resize?.disconnect();
    this.motion.removeEventListener("change", this.refreshMotion);
    document.removeEventListener("visibilitychange", this.refreshMotion);
    if (this.texture) this.texture.onload = null;
  }
}
