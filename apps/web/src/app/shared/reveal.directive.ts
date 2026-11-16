import { AfterViewInit, Directive, ElementRef, OnDestroy } from "@angular/core";
import { animate, inView } from "motion";
@Directive({ selector: "[appReveal]", standalone: true })
export class RevealDirective implements AfterViewInit, OnDestroy {
  private stop?: () => void;
  private animation?: ReturnType<typeof animate>;
  constructor(private readonly el: ElementRef<HTMLElement>) {}
  ngAfterViewInit(): void {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    this.stop = inView(
      this.el.nativeElement,
      (element) => {
        this.animation = animate(
          element,
          { opacity: [0, 1], y: [14, 0] },
          { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
        );
      },
      { margin: "0px 0px -30px 0px" },
    );
  }
  ngOnDestroy(): void {
    this.stop?.();
    this.animation?.stop();
  }
}
