import { expect, test, Page } from "./fixtures";

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
    if (url.pathname.startsWith('/api/places/')) return route.fulfill({ json: [] });
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
    if (url.pathname.endsWith("/catalogue"))
      return route.fulfill({ json: { beaches, nextCursor: null } });
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

test('prévisions : courant en m/s et interruption de courbe pour une mesure absente', async ({ page }) => {
  await page.route('**/api/score/beach/*', route => route.fulfill({ json: {
    ...score, forecast: { current: [
      { time: '2026-07-15T12:00:00Z', value: 1 },
      { time: '2026-07-15T13:00:00Z', value: null },
      { time: '2026-07-15T14:00:00Z', value: 0 },
    ] },
  } }));
  await page.goto('/plages/test-sea');
  await page.getByRole('group', { name: 'Mesure du graphique' }).getByRole('button', { name: 'Courant', exact: true }).click();
  await expect(page.locator('.chart-heading')).toContainText('m/s');
  await expect(page.locator('.forecast-chart circle')).toHaveCount(2);
  await expect(page.locator('.forecast-chart path')).toHaveAttribute('d', /^M[^L]* M[^L]*$/);
  await page.getByText('Valeurs détaillées').click();
  await expect(page.locator('.chart-table tbody tr').nth(0)).toContainText('1 m/s');
  await expect(page.locator('.chart-table tbody tr').nth(1)).toContainText('— m/s');
  await expect(page.locator('.chart-table tbody tr').nth(2)).toContainText('0 m/s');
  await noOverflow(page);
});

test('conditions : panne fournisseur sans faux score ni courbe', async ({ page }) => {
  await page.route('**/api/score/beach/*', route => route.fulfill({ json: {
    ...score, scores: { bathing: null, family: null, paddle: null, boat: null },
    current: { weather: { temperature_2m: null, uv_index: null }, marine: {} },
    forecast: { air: [], water: [], uv: [], wave: [] },
    dataStatus: { weather: { status: 'unknown' }, marine: { status: 'unknown' } },
  } }));
  await page.goto('/plages/test-sea');
  await expect(page.locator('.usage-scores strong')).toHaveText(['—', '—', '—', '—']);
  await expect(page.getByText('Score indisponible : données récentes insuffisantes.')).toBeVisible();
  await expect(page.getByText(/Open-Meteo : Données indisponibles/)).toBeVisible();
  await expect(page.locator('.forecast-chart svg')).toHaveCount(0);
  await noOverflow(page);
});

test('conditions : dernier relevé sourcé explicitement ancien, zéro réel affichable', async ({ page }) => {
  await page.route('**/api/score/beach/*', route => route.fulfill({ json: {
    ...score, scores: { bathing: null, family: null, paddle: null, boat: null },
    current: { ...score.current, weather: { ...score.current.weather, temperature_2m: 0 } },
    dataStatus: { weather: { status: 'stale', ageSeconds: 1800 }, marine: { status: 'partial', ageSeconds: 60 } },
  } }));
  await page.goto('/plages/test-sea');
  await expect(page.getByText(/Dernières prévisions conservées, fournisseur indisponible.*30 min/)).toBeVisible();
  await expect(page.locator('.conditions-grid strong').first()).toContainText('0');
  await expect(page.locator('.forecast-chart svg path')).toHaveCount(1);
  await noOverflow(page);
});

test('recherche : catalogue complet au-dela de 180 et 500 plages', async ({ page }) => {
  const catalogue = Array.from({ length: 602 }, (_, i) => ({
    ...beaches[0], id: `page-${i}`, name: `Escale ${String(i).padStart(4, '0')}`,
  }));
  const cursors: number[] = [];
  await page.route('**/api/beaches/catalogue?*', (route) => {
    const start = Number(new URL(route.request().url()).searchParams.get('after') || 0);
    cursors.push(start);
    return route.fulfill({ json: { beaches: catalogue.slice(start, start + 200),
      nextCursor: start + 200 < catalogue.length ? String(start + 200) : null } });
  });
  await page.goto('/recherche');
  await expect(page.locator('.results-heading h2')).toContainText('602 plages');
  expect(cursors).toEqual([0, 200, 400, 600]);
  await page.getByRole('combobox', { name: 'Rechercher dans les plages' }).fill('Escale 0601');
  await expect(page.locator('.results-heading h2')).toContainText('1 plage');
  await expect(page.getByRole('button', { name: 'Escale 0601', exact: true })).toBeVisible();
});

test('contrat : pagination canonique et localisation inconnue restent consultables', async ({ page }) => {
  const cursors: Array<string | null> = [];
  await page.route('**/api/beaches/catalogue?*', route => {
    const after = new URL(route.request().url()).searchParams.get('after');
    cursors.push(after);
    return route.fulfill({ json: {
      items: [{ ...beaches[after ? 1 : 0], city: null, department: null }],
      pageInfo: { nextCursor: after ? null : 'next-page', hasNextPage: !after, limit: 200 },
    } });
  });
  await page.goto('/recherche');
  await expect(page.getByRole('button', { name: 'Plage des Pins', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Berge des Saules', exact: true })).toBeVisible();
  expect(cursors).toEqual([null, 'next-page']);
  await noOverflow(page);
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

test('recherche : mer, lac, riviere et inconnu restent distincts', async ({ page }) => {
  const catalogue = [
    { ...beaches[0], name: 'Plage de La Baule', city: 'La Baule', department: 'Loire-Atlantique', region: 'Pays de la Loire' },
    { ...beaches[1], name: 'Berge de test' },
    { ...beaches[0], id: 'test-lake', name: 'Plage du lac sale', waterType: 'lake', coastline: 'Atlantique' },
    { ...beaches[0], id: 'test-unknown', name: 'Site non classe', waterType: 'unknown' },
  ];
  await page.route('**/api/beaches/catalogue?*', route => route.fulfill({ json: { beaches: catalogue, nextCursor: null } }));
  await page.goto('/recherche');
  await expect(page.locator('.beach-result')).toHaveCount(4);
  await page.getByRole('button', { name: 'Filtres', exact: true }).click();
  for (const [type, name] of [['sea', 'Plage de La Baule'], ['lake', 'Plage du lac sale'], ['river', 'Berge de test']]) {
    await page.getByLabel('Type d’eau').selectOption(type);
    await expect(page.locator('.beach-result')).toHaveCount(1);
    await expect(page.locator('.beach-name').getByRole('button', { name, exact: true })).toBeVisible();
  }
  await page.getByLabel('Type d’eau').selectOption('all');
  await expect(page.locator('.beach-result')).toHaveCount(4);
  await noOverflow(page);
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
  await expect(page.locator(".forecast-chart svg path")).toHaveAttribute('d', /L/);
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
  await page.route("**/api/beaches/catalogue?*", (route) =>
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

test("decor littoral : discret hors accueil, pause et mouvements reduits", async ({
  page,
}, info) => {
  await page.goto("/");
  await expect(page.locator(".coastal-backdrop")).toHaveCount(0);
  await page.getByRole("link", { name: "Trouver une plage" }).click();
  const backdrop = page.locator(".coastal-backdrop");
  const texture = page.locator(".coastal-texture");
  await expect(backdrop).toBeVisible();
  await expect(backdrop).toHaveAttribute("aria-hidden", "true");
  await expect(backdrop).toHaveCSS("pointer-events", "none");
  await expect(texture).toHaveCSS("opacity", "0.12");
  await expect
    .poll(() =>
      texture.evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  const first = await texture.evaluate(
    (image) => getComputedStyle(image).transform,
  );
  await expect
    .poll(() => texture.evaluate((image) => getComputedStyle(image).transform))
    .not.toBe(first);
  await page.getByRole("button", { name: "Mettre le décor en pause" }).click();
  await expect(texture).toHaveCSS("animation-play-state", "paused");
  await page.getByRole("button", { name: "Animer le décor" }).click();
  await expect(texture).toHaveCSS("animation-play-state", "running");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(texture).toHaveCSS("animation-name", "none");
  await expect(page.locator(".coast-motion-control")).toBeHidden();
  for (const path of ["/recherche", "/plages/test-sea", "/contact"]) {
    await page.goto(path);
    await expect(texture).toBeVisible();
    await expect(texture).toHaveCSS("animation-name", "none");
    await noOverflow(page);
    await page.screenshot({
      path: info.outputPath(`coast-${path.split("/").pop()}.png`),
      fullPage: true,
    });
  }
  await page.goto("/?preview=true");
  await expect(backdrop).toHaveCount(0);
});
