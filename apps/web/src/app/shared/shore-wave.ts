// Seeded foam stays coherent between frames instead of flickering like noise.
let seed = 42;
function random(): number {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
}
const foam = Array.from({ length: 1100 }, () => ({
  x: random() * 680 - 20,
  wake: random(),
  radius: 0.5 + random() * 2.3,
  alpha: 0.3 + random() * 0.6,
}));

function crest(x: number, time: number, phase: number): number {
  return (
    -24 +
    phase * 250 +
    Math.sin(x * 0.012 + time * 0.22 + phase) * 11 +
    Math.sin(x * 0.037 - time * 0.36) * 4 +
    Math.sin(x * 0.093 + time * 0.4) * 1.8 +
    Math.sin(x * 0.28 - time * 0.3) * 1.1
  );
}

export function paintShoreWave(
  ctx: CanvasRenderingContext2D,
  texture: HTMLImageElement | undefined,
  time: number,
): void {
  const width = ctx.canvas.width;
  const height = 200;
  ctx.save();
  ctx.scale(1, ctx.canvas.height / height);
  ctx.clearRect(0, 0, width, height);
  const water = ctx.createLinearGradient(0, 0, 0, height);
  water.addColorStop(0, "#228f9f");
  water.addColorStop(0.55, "#61cccf");
  water.addColorStop(1, "#d2eee6");
  ctx.fillStyle = water;
  ctx.fillRect(0, 0, width, height);

  // Refract the existing cove's open-water texture in small horizontal strips.
  if (texture?.complete && texture.naturalWidth) {
    const sx = texture.naturalWidth * 0.03;
    const sy = texture.naturalHeight * 0.22;
    const aspect = ctx.canvas.width / ctx.canvas.height;
    const sw = Math.min(
      texture.naturalWidth * 0.46,
      texture.naturalHeight * 0.45 * aspect,
    );
    const sh = sw / aspect;
    ctx.globalAlpha = 0.8;
    for (let y = 0; y < height; y += 4) {
      const drift = Math.sin(y * 0.06 + time * 0.8) * 2.4;
      ctx.drawImage(
        texture,
        sx + drift,
        sy + (y / height) * sh,
        sw,
        (sh * 4) / height,
        -4,
        y,
        width + 8,
        4,
      );
    }
    ctx.globalAlpha = 1;
  }

  for (let wave = 0; wave < 2; wave++) {
    const phase = (time / 5.5 + wave * 0.5) % 1;
    const strength = Math.pow(Math.sin(phase * Math.PI), 0.6);
    const front = (x: number) => crest(x, time, phase);
    // Fine curved ribbons form the aerated wash behind the breaking crest.
    for (let layer = 38; layer >= 0; layer--) {
      ctx.beginPath();
      for (let x = -6; x <= width + 6; x += 3) {
        const breakup =
          Math.sin(x * 0.045 + layer * 0.5 - time * 0.5) * layer * 0.16;
        const y = front(x) - layer * 1.05 + breakup;
        if (x === -6) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineWidth = layer < 3 ? 1.4 : 1.2;
      ctx.strokeStyle = `rgba(248,255,253,${strength * (layer < 3 ? 0.62 : (1 - layer / 40) * 0.28)})`;
      ctx.stroke();
    }
    ctx.beginPath();
    for (let x = 0; x <= width; x += 4) {
      const y = front(x) + 3;
      if (!x) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `rgba(10,117,130,${0.15 * strength})`;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    for (const dot of foam) {
      const x =
        (dot.x * width) / 640 + Math.sin(time * 0.55 + dot.wake * 6) * 6;
      const wakeWidth = 30 + Math.sin(x * 0.04 + time * 0.3) * 10;
      const y = front(x) - dot.wake * wakeWidth;
      const dissolve = 0.8 + Math.sin(time * 0.8 + dot.x * 0.08) * 0.2;
      ctx.fillStyle = `rgba(255,255,252,${dot.alpha * (1 - dot.wake * 0.65) * strength * dissolve})`;
      ctx.beginPath();
      ctx.ellipse(
        x,
        y,
        dot.radius * 1.6,
        dot.radius * 0.65,
        -0.2,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }
  ctx.restore();
}
