import {
  AfterViewInit,
  Component,
  ChangeDetectorRef,
  ElementRef,
  NgZone,
  OnDestroy,
  ViewChild,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { IconComponent } from "./icon.component";
import type * as Three from "three";
import { oceanShoreFragmentShader } from "./ocean-shore.shader";

@Component({
  selector: "app-ocean-scene",
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: ` <img
      src="/images/lagune.jpg"
      alt=""
      fetchpriority="high"
      class="coast-image"
    />
    <div #surface class="water-surface" aria-hidden="true"></div>
    <button
      *ngIf="ready"
      class="motion-toggle"
      (click)="toggle()"
      [attr.aria-label]="paused ? 'Animer la mer' : 'Mettre la mer en pause'"
      [attr.title]="paused ? 'Animer la mer' : 'Mettre la mer en pause'"
    >
      <app-icon [name]="paused ? 'play' : 'pause'" [size]="15" />
    </button>`,
  styles: [
    `
      :host {
        --coast-position: 50%;
        position: absolute;
        inset: 0;
        display: block;
        overflow: hidden;
        background: #8ad4d6;
      }
      .coast-image {
        position: absolute;
        width: 100%;
        height: 100%;
        object-fit: cover;
        object-position: var(--coast-position) center;
      }
      .water-surface {
        position: absolute;
        inset: 0;
      }
      .water-surface canvas {
        display: block;
        width: 100%;
        height: 100%;
      }
      .motion-toggle {
        position: absolute;
        right: 22px;
        bottom: 18px;
        z-index: 5;
        width: 34px;
        height: 34px;
        display: grid;
        place-items: center;
        background: #ffffffcf;
        border: 1px solid #ffffff80;
        border-radius: 50%;
        color: #245158;
      }
      @media (max-width: 1000px) {
        :host {
          --coast-position: 80%;
        }
      }
    `,
  ],
})
export class OceanSceneComponent implements AfterViewInit, OnDestroy {
  @ViewChild("surface", { static: true }) el!: ElementRef<HTMLDivElement>;
  ready = false;
  paused = matchMedia("(prefers-reduced-motion: reduce)").matches;
  private renderer?: Three.WebGLRenderer;
  private observer?: ResizeObserver;
  private visibility?: IntersectionObserver;
  private disposeScene?: () => void;
  private setPlayback?: (running: boolean) => void;
  private initializing = false;
  private destroyed = false;
  private visible = true;
  private media = matchMedia("(prefers-reduced-motion: reduce)");
  private readonly motionChange = () => {
    this.paused = this.media.matches;
    if (!this.paused && !this.renderer) void this.createScene();
    this.updatePlayback();
    this.cdr.markForCheck();
  };
  private readonly pageVisibilityChange = () => this.updatePlayback();
  constructor(
    private readonly zone: NgZone,
    private readonly cdr: ChangeDetectorRef,
  ) {}
  async ngAfterViewInit(): Promise<void> {
    this.media.addEventListener("change", this.motionChange);
    document.addEventListener("visibilitychange", this.pageVisibilityChange);
    if (this.media.matches) return;
    await this.createScene();
  }
  private async createScene(): Promise<void> {
    if (this.initializing || this.destroyed || this.renderer) return;
    this.initializing = true;
    let texture: Three.Texture | undefined;
    try {
      const T = await import("three");
      if (this.destroyed) return;
      texture = await new T.TextureLoader().loadAsync("/images/lagune.jpg");
      if (this.destroyed) {
        texture.dispose();
        return;
      }
      const source = texture.image as HTMLImageElement;
      const imageRatio = source.naturalWidth / source.naturalHeight;
      this.zone.runOutsideAngular(() => {
        const host = this.el.nativeElement;
        const renderer = new T.WebGLRenderer({
          alpha: true,
          antialias: false,
          powerPreference: "low-power",
        });
        this.renderer = renderer;
        renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
        host.appendChild(renderer.domElement);
        const scene = new T.Scene();
        const camera = new T.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
        camera.position.z = 3;
        const uniforms = {
          image: { value: texture },
          time: { value: 0 },
          coverScale: { value: new T.Vector2(1, 1) },
          coverOffset: { value: new T.Vector2(0, 0) },
          pointer: { value: new T.Vector2(0.5, 0.5) },
        };
        const material = new T.ShaderMaterial({
          uniforms,
          vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
          fragmentShader: oceanShoreFragmentShader,
        });
        const geometry = new T.PlaneGeometry(2, 2);
        scene.add(new T.Mesh(geometry, material));
        // A small three-dimensional buoy gives the water a stable scale reference.
        const buoy = new T.Group();
        const ballGeo = new T.SphereGeometry(0.032, 20, 14);
        const ballMat = new T.MeshStandardMaterial({
          color: "#e16b4c",
          roughness: 0.45,
        });
        const ball = new T.Mesh(ballGeo, ballMat);
        buoy.add(ball);
        const ringGeo = new T.TorusGeometry(0.012, 0.003, 8, 16);
        const ringMat = new T.MeshStandardMaterial({
          color: "#eac8a6",
          roughness: 0.7,
        });
        const ring = new T.Mesh(ringGeo, ringMat);
        ring.position.y = 0.04;
        buoy.add(ring);
        buoy.position.set(0.3, -0.2, 0.2);
        scene.add(buoy);
        scene.add(new T.HemisphereLight(0xffffff, 0x406766, 2.2));
        const sun = new T.DirectionalLight(0xfff6df, 2.6);
        sun.position.set(-2, 4, 5);
        scene.add(sun);
        const resize = () => {
          const w = host.clientWidth,
            h = host.clientHeight;
          if (!w || !h) return;
          renderer.setSize(w, h);
          const scaleX = Math.min(1, w / h / imageRatio);
          const scaleY = Math.min(1, imageRatio / (w / h));
          const position =
            parseFloat(
              getComputedStyle(host).getPropertyValue("--coast-position"),
            ) / 100;
          uniforms.coverScale.value.set(scaleX, scaleY);
          uniforms.coverOffset.value.set(
            (1 - scaleX) * position,
            (1 - scaleY) / 2,
          );
          buoy.scale.set(1 / (w / h), 1, 1);
          buoy.visible = w > 620;
          renderer.render(scene, camera);
        };
        this.observer = new ResizeObserver(resize);
        this.observer.observe(host);
        resize();
        this.visibility = new IntersectionObserver(([entry]) => {
          this.visible = entry.isIntersecting;
          this.updatePlayback();
        });
        this.visibility.observe(host);
        const move = (event: PointerEvent) => {
          const rect = host.getBoundingClientRect();
          uniforms.pointer.value.set(
            (event.clientX - rect.left) / rect.width,
            1 - (event.clientY - rect.top) / rect.height,
          );
        };
        host.addEventListener("pointermove", move, { passive: true });
        let last = 0;
        const tick = (now: number) => {
          if (last && now - last < 1000 / 30) return;
          const delta = last ? Math.min((now - last) / 1000, 0.08) : 0;
          last = now;
          uniforms.time.value += delta;
          const t = uniforms.time.value;
          buoy.position.y = -0.2 + Math.sin(t * 0.9) * 0.012;
          buoy.rotation.z = Math.sin(t * 0.65) * 0.1;
          renderer.render(scene, camera);
        };
        this.setPlayback = (running) => {
          last = 0;
          renderer.domElement.dataset["motion"] = running ? "running" : "still";
          renderer.setAnimationLoop(running ? tick : null);
        };
        this.updatePlayback();
        this.disposeScene = () => {
          host.removeEventListener("pointermove", move);
          geometry.dispose();
          material.dispose();
          texture?.dispose();
          ballGeo.dispose();
          ballMat.dispose();
          ringGeo.dispose();
          ringMat.dispose();
        };
        this.zone.run(() => {
          this.ready = true;
          this.cdr.markForCheck();
        });
      });
    } catch {
      if (!this.disposeScene) texture?.dispose();
      this.releaseScene();
    } finally {
      this.initializing = false;
    }
  }
  private updatePlayback(): void {
    this.setPlayback?.(
      !this.destroyed && !this.paused && this.visible && !document.hidden,
    );
  }
  toggle(): void {
    this.paused = !this.paused;
    this.updatePlayback();
  }
  private releaseScene(): void {
    this.observer?.disconnect();
    this.visibility?.disconnect();
    this.renderer?.setAnimationLoop(null);
    this.disposeScene?.();
    this.renderer?.domElement.remove();
    this.renderer?.dispose();
    this.renderer = undefined;
    this.disposeScene = undefined;
    this.setPlayback = undefined;
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    this.media.removeEventListener("change", this.motionChange);
    document.removeEventListener("visibilitychange", this.pageVisibilityChange);
    this.releaseScene();
  }
}
