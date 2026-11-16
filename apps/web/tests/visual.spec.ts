import { expect, test, Page } from "@playwright/test";

const beaches = [
  {
    id: "test-sea",
    name: "Plage des Pins",
    city: "Hyères",
    department: "Var",
    region: "Provence",
    coastline: "Méditerranée",
    waterType: "sea",
    lat: 43.08,
    lon: 6.15,
    has_parking: true,
    has_toilets: true,
    has_lifeguard: false,
    distanceKm: 2,
  },
  {
    id: "test-river",
    name: "Berge des Saules",
    city: "Lyon",
    department: "Rhône",
    region: "Rhône-Alpes",
    coastline: "Eau douce",
    waterType: "river",
    lat: 45.76,
    lon: 4.84,
    has_parking: false,
    has_toilets: false,
    has_lifeguard: false,
    distanceKm: 5,
  },
];
const score = {
  beach: beaches[0],
  scores: { bathing: 64, family: 58, paddle: 70, boat: 65 },
  current: {
    weather: {
      temperature_2m: 24,
      wind_speed_10m: 12,
      uv_index: 5,
      time: "2026-07-15T12:00:00Z",
    },
    marine: { sea_surface_temperature: 21, wave_height: 0.4 },
  },
  providers: { weather: "open-meteo", marine: "open-meteo-marine" },
  safety: { flag: "red", official: false, alerts: ["Vent soutenu"] },
  forecast: {
    air: [
      { time: "2026-07-15T12:00:00Z", value: 24 },
      { time: "2026-07-15T15:00:00Z", value: 26 },
      { time: "2026-07-15T18:00:00Z", value: 23 },
    ],
  },
};

async function mockApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("/score/")) return route.fulfill({ json: score });
    if (url.pathname.endsWith("/amenities"))
      return route.fulfill({
        json: {
          beachId: beaches[0].id,
          provider: "openstreetmap",
          radiusMeters: 2500,
          amenities: [
            {
              id: "parking1",
              name: "Parking du port",
              category: "parking",
              lat: 43.081,
              lon: 6.151,
              distanceKm: 0.2,
              source: "openstreetmap",
            },
            {
              id: "fake",
              name: "Faux parking",
              category: "parking",
              lat: 43,
              lon: 6,
              distanceKm: 1,
              source: "local-hint",
            },
          ],
        },
      });
    if (url.pathname.endsWith("/reports")) return route.fulfill({ json: [] });
    if (url.pathname.endsWith("/discover"))
      return route.fulfill({
        json: {
          provider: "openstreetmap-cache",
          imported: 1,
          beaches: [beaches[0]],
        },
      });
    if (url.pathname.endsWith("/beaches"))
      return route.fulfill({ json: beaches });
    if (url.pathname.includes("/beaches/"))
      return route.fulfill({ json: beaches[0] });
    return route.fulfill({ json: beaches });
  });
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.waitForTimeout(100);
}
test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test("accueil : scene, carte et navigation responsive", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
    "href",
    "/favicon.svg",
  );
  const favicon = await page.request.get("/favicon.svg");
  expect(favicon.ok()).toBe(true);
  const iconMarkup = await favicon.text();
  expect(iconMarkup).toContain('fill="#007eaa"');
  expect(iconMarkup).toContain('fill="#d94d3b"');
  await expect(page.getByRole("heading", { name: "Littora." })).toBeVisible();
  await expect(
    page.locator(".leaflet-overlay-pane path").first(),
  ).toBeAttached();
  await expect(page.locator("app-ocean-scene canvas")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Mettre la mer en pause" }),
  ).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath("home.png"), fullPage: true });
  await page.getByRole("link", { name: "Trouver une plage" }).click();
  await expect(page).toHaveURL(/recherche/);
  expect(errors).toEqual([]);
});

test("recherche : filtres, apercu distinct et retour", async ({
  page,
}, info) => {
  await page.goto("/recherche");
  await expect(page.locator(".beach-result")).toHaveCount(2);
  await page.getByRole("button", { name: "Filtres", exact: true }).click();
  await page.getByLabel("Type d’eau").selectOption("river");
  await expect(page.locator(".beach-result")).toHaveCount(1);
  await expect(page.locator(".beach-name")).toContainText("Berge des Saules");
  await page.getByLabel("Type d’eau").selectOption("all");
  await page.getByLabel("Parking", { exact: true }).check();
  await expect(page.locator(".beach-result")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Plage des Pins", exact: true })
    .click();
  await expect(page).toHaveURL(/recherche/);
  await expect(page.locator(".overview-metrics")).toBeVisible();
  await expect(page.locator(".overview-metrics")).toContainText("24");
  await noOverflow(page);
  await page.screenshot({
    path: info.outputPath("search.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "Détails", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Plage des Pins", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Retour aux plages" }).click();
  await page.getByRole("button", { name: /Filtres/ }).click();
  await expect(page.getByLabel("Parking", { exact: true })).toBeChecked();
});

test("detail : series reelles, indisponibilite et equipements", async ({
  page,
}, info) => {
  await page.goto("/plages/test-sea");
  await expect(page.locator(".conditions-grid")).toBeVisible();
  await expect(page.locator(".official-status")).toContainText("Non renseigné");
  await expect(
    page.getByText("Parking du port", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("Faux parking")).toHaveCount(0);
  await expect(page.locator(".forecast-chart svg path")).toHaveCount(1);
  await page.getByRole("button", { name: "Eau", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Prévisions non disponibles" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Air", exact: true }).click();
  await noOverflow(page);
  await page.screenshot({
    path: info.outputPath("detail.png"),
    fullPage: true,
  });
  await page.route("**/api/reports", (route) =>
    route.fulfill({ status: 503, json: { error: "Unavailable" } }),
  );
  await page.getByRole("button", { name: "Méduses", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "n’a pas pu être envoyée",
  );
});

test("contact : pas de faux succes et champs accessibles", async ({
  page,
}, info) => {
  await page.goto("/contact");
  await expect(
    page.getByText("L’envoi direct est indisponible pour le moment."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Copier le message" }),
  ).toBeDisabled();
  await page.getByLabel("Votre nom").fill("Test");
  await page.getByLabel("Adresse e-mail").fill("test@example.org");
  await page
    .getByLabel("Votre message", { exact: true })
    .fill("Message de recette.");
  await expect(
    page.getByRole("button", { name: "Copier le message" }),
  ).toBeEnabled();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copier le message" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Message copié. Aucun message",
  );
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "Message de recette.",
  );
  await noOverflow(page);
  await page.screenshot({
    path: info.outputPath("contact.png"),
    fullPage: true,
  });
});

test("erreur API et refus de geolocalisation sans fausse position", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "geolocation", {
      value: { getCurrentPosition: (_ok: unknown, fail: () => void) => fail() },
    }),
  );
  await page.route("**/api/beaches?*", (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  await page.goto("/recherche");
  await expect(page.getByRole("alert")).toContainText("pas disponibles");
  await page.getByRole("button", { name: "Autour de moi" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Position non disponible",
  );
  await noOverflow(page);
});

test("reduction des mouvements : image fixe et menu clavier", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".coast-image")).toBeVisible();
  await expect(page.locator("app-ocean-scene canvas")).toHaveCount(0);
  if (info.project.name === "mobile") {
    await page.getByRole("button", { name: "Ouvrir le menu" }).click();
    await expect(
      page.getByRole("navigation", { name: "Navigation principale" }),
    ).toBeVisible();
    await page
      .getByRole("navigation", { name: "Navigation principale" })
      .getByRole("link", { name: "Contact" })
      .click();
    await expect(page).toHaveURL(/contact/);
  }
  await noOverflow(page);
});

test("carte : facade selectionnable et reperes visibles", async ({ page }) => {
  await page.goto("/");
  const label = page.locator(".zone-marker").filter({ hasText: "Bretagne" });
  await expect(label).toBeVisible();
  await label.click();
  await expect(page).toHaveURL(/zone=bretagne/);
  if ((page.viewportSize()?.width ?? 1440) < 761)
    await page.getByRole("button", { name: "Carte", exact: true }).click();
  const selectedZone = page.locator("app-coast-map .zone-marker.selected");
  await expect(selectedZone).toHaveCount(1);
  await expect(selectedZone).toBeVisible();
  expect(
    await page
      .locator("app-coast-map .leaflet-overlay-pane path")
      .evaluateAll(
        (paths) =>
          paths.filter((p) => (p.getAttribute("d")?.length ?? 0) > 20).length,
      ),
  ).toBeGreaterThan(0);
  await noOverflow(page);
});
