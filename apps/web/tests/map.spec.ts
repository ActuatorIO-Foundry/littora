import { expect, test } from "./fixtures";

test("carte : fond detaille et limite officielle sans geometrie tronquee", async ({ page }) => {
  const requests: URL[] = [];
  page.on("request", request => requests.push(new URL(request.url())));
  await page.goto("/");
  await expect(page.locator(".basemap-tiles")).toBeAttached();
  await expect(page.locator(".shoreline-tiles")).toBeAttached();
  await expect(page.locator(".leaflet-control-attribution")).toContainText("Shom-IGN, 2021");
  await expect(page.locator(".leaflet-control-attribution")).toContainText("OpenStreetMap");
  await expect.poll(() => requests.some(url => url.searchParams.get("layers") === "LIMTM_3857_WMSV")).toBe(true);
  expect(requests.some(url => url.pathname.endsWith("coasts.geojson"))).toBe(false);
  expect(await page.locator(".leaflet-shoreline-pane").evaluate(el => getComputedStyle(el).pointerEvents)).toBe("none");
});

test("carte : selection de facade appliquee au trait reel et contours conserves au zoom", async ({ page }) => {
  await page.goto("/recherche?zone=azur");
  if ((page.viewportSize()?.width ?? 1440) < 761) {
    await page.getByRole("button", { name: "Carte", exact: true }).click();
  }
  const pane = page.locator(".leaflet-shoreline-selected-pane");
  await expect(page.locator(".shoreline-selected-tiles")).toBeAttached();
  await expect.poll(() => pane.evaluate(el => (el as HTMLElement).style.clipPath)).toMatch(/^polygon\(/);
  const before = await pane.evaluate(el => (el as HTMLElement).style.clipPath);
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect.poll(() => pane.evaluate(el => (el as HTMLElement).style.clipPath)).not.toBe(before);
  await page.getByRole("button", { name: "Recentrer la carte" }).click();
  await expect(page.locator(".zone-marker.selected")).toHaveCount(1);
});

test("carte : panne du trait officiel explicite sans retirer le fond detaille", async ({ page }) => {
  await page.route("https://services.data.shom.fr/**", route => route.abort());
  await page.goto("/");
  await expect(page.locator(".map-error")).toContainText("Limite terre-mer indisponible");
  await expect(page.locator(".basemap-tiles .leaflet-tile-loaded").first()).toBeAttached();
});
