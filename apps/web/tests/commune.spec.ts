import { expect, test } from "./fixtures";
import { searchResult } from './search-response';

const bandol = {
  code: "83009",
  name: "Bandol",
  department: { code: "83", name: "Var" },
  region: { code: "93", name: "Provence" },
  center: { lat: 43.14, lon: 5.75 },
  bbox: [43.12, 5.72, 43.17, 5.78],
  contour: {
    type: "Polygon",
    coordinates: [
      [
        [5.72, 43.12],
        [5.78, 43.12],
        [5.76, 43.17],
        [5.72, 43.12],
      ],
    ],
  },
};
const beaches = [
  "Renecros",
  "Barry",
  "Eden Roc",
  "Capelan",
  "Engraviers",
  "Casino",
  "Grand Vallat",
  "Centrale",
].map((name, i) => ({
  id: `bandol-${i}`,
  name: `Plage ${name}`,
  city: "Bandol",
  region: "Provence",
  department: "Var",
  lat: 43.13 + i * 0.001,
  lon: 5.74 + i * 0.002,
  waterType: "sea",
  has_parking: null,
}));
const local = [
  { ...beaches[0], id: "outside", name: "Autre plage", city: "Autre commune" },
];

test.beforeEach(async ({ page }) => {
  await page.route("**/api/search/beaches", route => {
    const input=route.request().postDataJSON();
    return route.fulfill({json:searchResult(input,input.communeCode?beaches:local,input.communeCode?bandol:null)});
  });
  await page.route("**/api/places/communes?*", (route) =>
    route.fulfill({ json: [bandol] }),
  );
});

test("commune : recherche exacte, contour, huit plages et retour au catalogue", async ({
  page,
}) => {
  await page.goto("/recherche?q=Bandol");
  await expect(page.locator(".commune-selection")).toContainText("Bandol");
  await expect(page.locator(".results-heading h2")).toContainText("8 plages");
  await expect(page).toHaveURL(/commune=83009/);
  await expect(page.locator(".beach-result")).toHaveCount(8);
  if ((page.viewportSize()?.width ?? 1440) < 761)
    await page.getByRole("button", { name: "Carte", exact: true }).click();
  const outline = page.locator(".commune-boundary");
  await expect(outline).toBeVisible();
  const box = await outline.boundingBox();
  expect(box!.width).toBeGreaterThan(100);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Retirer la commune" }).click();
  await expect(outline).toHaveCount(0);
  await expect(page).not.toHaveURL(/commune=/);
  await expect(page.locator(".results-heading h2")).toContainText("1 plage");
});

test("commune : homonymes selectionnables au clavier", async ({ page }) => {
  await page.route("**/api/places/communes?*", (route) =>
    route.fulfill({
      json: [
        {
          ...bandol,
          name: "Saint-Pierre",
          code: "01001",
          department: { code: "01", name: "Ain" },
        },
        { ...bandol, name: "Saint-Pierre", code: "83001" },
      ],
    }),
  );
  await page.route("**/api/search/beaches", route => {
    const input=route.request().postDataJSON();
    return input.communeCode==='83001'?route.fulfill({json:searchResult(input,beaches,{...bandol,code:'83001',name:'Saint-Pierre'})}):route.fallback();
  });
  await page.goto("/recherche");
  const input = page.getByRole("combobox", {
    name: "Rechercher dans les plages",
  });
  await input.fill("Saint-Pierre");
  await expect(
    page.getByRole("listbox", { name: "Communes" }).getByRole("option"),
  ).toHaveCount(2);
  await expect(page.locator(".commune-selection")).toHaveCount(0);
  await input.press("ArrowDown");
  await input.press("ArrowDown");
  await input.press("Enter");
  await expect(page.locator(".commune-selection")).toContainText(
    "Saint-Pierre",
  );
  await expect(page).toHaveURL(/commune=83001/);
});

test("commune : effacer la saisie annule une reponse de catalogue en cours", async ({
  page,
}) => {
  let started = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/search/beaches", async (route) => {
    const input=route.request().postDataJSON();if(!input.communeCode)return route.fallback();
    started = true;
    await gate;
    await route.fulfill({ json: searchResult(input,beaches,bandol) }).catch(() => undefined);
  });
  await page.goto("/recherche");
  const input = page.getByRole("combobox", {
    name: "Rechercher dans les plages",
  });
  await input.fill("Bandol");
  await expect.poll(() => started).toBe(true);
  await input.fill("");
  release();
  await expect(page.locator(".results-heading h2")).toContainText("1 plage");
  await page.waitForTimeout(400);
  await expect(page.locator(".commune-selection")).toHaveCount(0);
  await expect(input).toHaveValue("");
  await expect(page).not.toHaveURL(/commune=/);
});

test("commune : lien direct et inventaire non exhaustif sans collecte", async ({
  page,
}) => {
  await page.route("**/api/search/beaches", (route) =>
    route.fulfill({ json: searchResult(route.request().postDataJSON(),beaches.slice(0,1),bandol) }),
  );
  await page.goto("/recherche?commune=83009");
  await expect(page.locator(".commune-selection")).toContainText("Bandol");
  await expect(
    page.getByText("Inventaire non exhaustif.", { exact: false }),
  ).toBeVisible();
  await expect(page.locator(".results-heading h2")).toContainText("1 plage");
});

test("commune : choisir une facade retire la selection et la recherche precedentes", async ({ page }) => {
  await page.route('**/api/beaches/discover?*', route => route.fulfill({ json: { provider: 'test', beaches: local, imported: 0 } }));
  await page.goto('/recherche?commune=83009');
  await expect(page.locator('.commune-selection')).toContainText('Bandol');
  await page.getByLabel('Façade géographique').selectOption('azur');
  await expect(page.locator('.commune-selection')).toHaveCount(0);
  await expect(page.locator('.commune-boundary')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Rechercher dans les plages' })).toHaveValue('');
  await expect(page).not.toHaveURL(/commune=|q=/);
  await expect(page).toHaveURL(/zone=azur/);
  await expect(page.locator('.results-heading h2')).toContainText('1 plage');
});
