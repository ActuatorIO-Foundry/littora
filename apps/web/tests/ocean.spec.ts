import { expect, Page, test } from "./fixtures";

async function patches(page: Page) {
  const image = await page.locator("app-ocean-scene canvas").screenshot();
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(image, 0, 0);
    const host = document.querySelector<HTMLElement>(".water-surface")!;
    const photo = document.querySelector<HTMLImageElement>(".coast-image")!;
    const ratio = photo.naturalWidth / photo.naturalHeight;
    const scaleX = Math.min(1, host.clientWidth / host.clientHeight / ratio);
    const scaleY = Math.min(1, ratio / (host.clientWidth / host.clientHeight));
    const position =
      parseFloat(getComputedStyle(host).getPropertyValue("--coast-position")) /
      100;
    const offsetX = (1 - scaleX) * position;
    const offsetY = (1 - scaleY) / 2;
    const read = (x: number, y: number, w: number, h: number) => {
      const left = Math.round(((x - offsetX) / scaleX) * canvas.width);
      const top = Math.round((1 - (y - offsetY) / scaleY) * canvas.height);
      const width = Math.round((w / scaleX) * canvas.width);
      const height = Math.round((h / scaleY) * canvas.height);
      if (
        left < 0 ||
        top < 0 ||
        left + width > canvas.width ||
        top + height > canvas.height
      ) {
        throw new Error("Shoreline is outside the responsive crop");
      }
      return Array.from(ctx.getImageData(left, top, width, height).data);
    };
    return {
      shore: read(0.78, 0.61, 0.08, 0.14),
      rocks: read(0.79, 0.81, 0.025, 0.025),
    };
  }, image.toString("base64"));
}

function difference(a: number[], b: number[]) {
  return (
    a.reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0) / a.length
  );
}

test("accueil : ressac visible sur la plage, rochers fixes et pause", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /webgl|shader/i.test(message.text()))
      errors.push(message.text());
  });
  await page.goto("/");
  const canvas = page.locator("app-ocean-scene canvas");
  await expect(canvas).toHaveAttribute("data-motion", "running");
  const before = await patches(page);
  let darkest = 255;
  let lightest = 0;
  for (let i = 0; i < before.shore.length; i++) {
    if (i % 4 === 3) continue;
    darkest = Math.min(darkest, before.shore[i]);
    lightest = Math.max(lightest, before.shore[i]);
  }
  expect(lightest - darkest).toBeGreaterThan(80);
  await page.waitForTimeout(1300);
  const after = await patches(page);
  expect(difference(before.shore, after.shore)).toBeGreaterThan(0.3);
  expect(difference(before.rocks, after.rocks)).toBeLessThan(0.1);
  await page.getByRole("button", { name: "Mettre la mer en pause" }).click();
  await expect(canvas).toHaveAttribute("data-motion", "still");
  const paused = await patches(page);
  await page.waitForTimeout(300);
  // Compare the sea pixels, not the controls and text composited above it.
  const still = await patches(page);
  expect(difference(paused.shore, still.shore)).toBe(0);
  expect(difference(paused.rocks, still.rocks)).toBe(0);
  await page
    .locator(".hero")
    .screenshot({ path: info.outputPath("shoreline.png") });
  await page.getByRole("button", { name: "Animer la mer" }).click();
  await expect(canvas).toHaveAttribute("data-motion", "running");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(canvas).toHaveAttribute("data-motion", "still");
  expect(errors).toEqual([]);
});

test("accueil : reprise des preferences et arret hors ecran", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".coast-image")).toBeVisible();
  await expect(page.locator("app-ocean-scene canvas")).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const canvas = page.locator("app-ocean-scene canvas");
  await expect(canvas).toHaveAttribute("data-motion", "running");
  await page.locator("footer").scrollIntoViewIfNeeded();
  await expect(canvas).toHaveAttribute("data-motion", "still");
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await expect(canvas).toHaveAttribute("data-motion", "running");
  await page.setViewportSize({ width: 500, height: 850 });
  await patches(page);
  await page.getByRole("link", { name: "Trouver une plage" }).click();
  await expect(page.locator("app-ocean-scene canvas")).toHaveCount(0);
});

test("accueil : la photo reste disponible sans WebGL", async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      ...args: Parameters<typeof getContext>
    ) {
      if (String(args[0]).startsWith("webgl")) {
        document.documentElement.dataset["webglAttempted"] = "true";
        return null;
      }
      return getContext.apply(this, args);
    } as typeof getContext;
  });
  await page.goto("/");
  await expect(page.locator(".coast-image")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Littora." })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute(
    "data-webgl-attempted",
    "true",
  );
  await expect(page.locator("app-ocean-scene canvas")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Mettre la mer en pause" }),
  ).toHaveCount(0);
});
