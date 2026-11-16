import { expect, Page, test } from "./fixtures";

async function holdCatalogue(page: Page): Promise<() => void> {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/beaches?*", async (route) => {
    await ready;
    await route.fulfill({ json: [] });
  });
  return release;
}

async function frame(page: Page): Promise<string> {
  return page
    .locator(".loading-wave")
    .evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL());
}

test("chargement : vague visible, animee et arret dynamique", async ({
  page,
}, info) => {
  const release = await holdCatalogue(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto("/recherche");
    const canvas = page.locator(".loading-wave");
    await expect(canvas).toBeVisible();
    const dimensions = await canvas.evaluate((el) => ({
      width: el.getBoundingClientRect().width,
      container: el.closest("app-loading")!.getBoundingClientRect().width,
      height: el.getBoundingClientRect().height,
    }));
    expect(dimensions.width).toBeCloseTo(dimensions.container, 1);
    expect(dimensions.height).toBe(200);
    const label = page.locator("app-loading .loading > span");
    await expect(label).toHaveCSS("color", "rgb(255, 255, 255)");
    const labelBox = (await label.boundingBox())!;
    const waveBox = (await canvas.boundingBox())!;
    expect(labelBox.y).toBeGreaterThan(waveBox.y);
    expect(labelBox.y + labelBox.height).toBeLessThan(
      waveBox.y + waveBox.height,
    );
    await expect(page.getByRole("status")).toContainText("prochaine escale");
    await expect(canvas).toHaveAttribute("data-motion", "running");
    const colors = await canvas.evaluate((element) => {
      const canvas = element as HTMLCanvasElement;
      const pixels = canvas
        .getContext("2d")!
        .getImageData(0, 0, canvas.width, canvas.height).data;
      let min = 255,
        max = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        min = Math.min(min, pixels[i]);
        max = Math.max(max, pixels[i]);
      }
      return max - min;
    });
    expect(colors).toBeGreaterThan(60);
    const before = await frame(page);
    await expect.poll(() => frame(page)).not.toBe(before);
    await page.screenshot({
      path: info.outputPath("wave-loading.png"),
      fullPage: true,
    });
    await canvas.screenshot({ path: info.outputPath("wave.png") });
    if ((page.viewportSize()?.width ?? 1440) < 761) {
      await page.getByRole("button", { name: "Carte", exact: true }).click();
      await expect(canvas).toBeHidden();
      await expect(canvas).toHaveAttribute("data-motion", "still");
      await page.getByRole("button", { name: "Liste", exact: true }).click();
      await expect(canvas).toHaveAttribute("data-motion", "running");
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(canvas).toHaveAttribute("data-motion", "still");
    await page.waitForTimeout(400);
    const still = await frame(page);
    await page.waitForTimeout(200);
    expect(await frame(page)).toBe(still);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    release();
  }
  await expect(page.locator("app-loading")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("chargement : mouvement reduit des le premier rendu", async ({ page }) => {
  const release = await holdCatalogue(page);
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/recherche");
    await expect(page.locator(".loading-wave")).toHaveAttribute(
      "data-motion",
      "still",
    );
    await page.waitForFunction(
      () =>
        performance.getEntriesByName(location.origin + "/images/lagune.jpg")
          .length > 0,
    );
    await page.waitForTimeout(100);
    const before = await frame(page);
    await page.waitForTimeout(250);
    expect(await frame(page)).toBe(before);
  } finally {
    release();
  }
  await expect(page.locator("app-loading")).toHaveCount(0);
});

test("chargement : pleine largeur de fiche et redimensionnement", async ({
  page,
}, info) => {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  await page.route("**/api/beaches/full-width", async (route) => {
    await ready;
    await route.fulfill({ status: 503, json: {} });
  });
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/plages/full-width");
    const canvas = page.locator(".loading-wave");
    await expect(canvas).toBeVisible();
    const viewport = page.viewportSize()!;
    for (const width of [viewport.width, 500, viewport.width]) {
      await page.setViewportSize({ width, height: viewport.height });
      await expect
        .poll(() =>
          canvas.evaluate((el) => {
            const wave = el as HTMLCanvasElement;
            return Math.abs(wave.width - wave.clientWidth * 2);
          }),
        )
        .toBeLessThanOrEqual(1);
      const sizes = await canvas.evaluate((el) => ({
        width: el.getBoundingClientRect().width,
        container: el.closest("app-loading")!.getBoundingClientRect().width,
        height: el.getBoundingClientRect().height,
      }));
      expect(sizes.width).toBeCloseTo(sizes.container, 1);
      expect(sizes.height).toBe(200);
    }
    await page.screenshot({
      path: info.outputPath("full-width-loading.png"),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    release();
  }
  await expect(page.locator("app-loading")).toHaveCount(0);
});

test("survol : relief discret sans deplacement de mise en page", async ({
  page,
}, info) => {
  await page.goto("/");
  const button = page.getByRole("link", { name: "Trouver une plage" });
  const coast = page.locator(".coast-list button").first();
  const pointer = await page.evaluate(
    () => matchMedia("(hover: hover) and (pointer: fine)").matches,
  );
  if (pointer) {
    await button.hover();
    await expect
      .poll(() => button.evaluate((el) => getComputedStyle(el).transform))
      .not.toBe("none");
    const bounds = await coast.boundingBox();
    await coast.hover();
    const icon = coast.locator("app-icon");
    await expect
      .poll(() => icon.evaluate((el) => getComputedStyle(el).transform))
      .not.toBe("none");
    const after = await coast.boundingBox();
    expect(after?.width).toBe(bounds?.width);
    expect(after?.height).toBe(bounds?.height);
    await coast.screenshot({ path: info.outputPath("coast-hover.png") });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  if (pointer) await button.hover();
  await expect
    .poll(() => button.evaluate((el) => getComputedStyle(el).transform))
    .toBe("none");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
