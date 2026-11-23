import { expect, test, Page } from "./fixtures";
import { searchResult } from './search-response';

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
const fetchedAt = '2026-07-15T11:45:00Z';
function forecastPoint(validAt: string, value: number | null, provider = 'open-meteo', unit = '°C') {
  return {validAt, value, fetchedAt, source:{provider,product:null}, unit, kind:'forecast',
    status:value === null ? 'unknown' : 'available',isDemo:false,producedAt:null,validUntil:null,
    resolution:{spatialMeters:null,temporalSeconds:null}};
}
const airStatus = {status:'available',provider:'open-meteo',kind:'forecast',fetchedAt,
  validAt:'2026-07-15T12:00:00Z',collectionIntervalSeconds:21600};
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
  dataStatus:{weather:airStatus,marine:{...airStatus,provider:'open-meteo-marine'}},
  measurements:{forecast:{air:[
    forecastPoint('2026-07-15T12:00:00Z',24),forecastPoint('2026-07-15T13:00:00Z',26),
    forecastPoint('2026-07-15T14:00:00Z',23),
  ]}},
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
    if (url.pathname === '/api/search/beaches') return route.fulfill({json:searchResult(route.request().postDataJSON(),beaches)});
    if (url.pathname.endsWith('/reports/session')) return route.fulfill({status:201,json:{token:'a'.repeat(64),expiresAt:'2099-01-01T00:00:00Z'}});
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
test('naturisme : filtres partageables, badge de secteur et source sur la fiche', async ({page}) => {
  const info = { status:'section', detail:'Uniquement au nord du repère.', source:'Mairie de test',
    sourceUrl:'https://example.org/plage', checkedOn:'2026-11-21' };
  const listed = {...beaches[0], naturism:info};
  const rows = [listed,{...listed,id:'entire',name:'Autre plage',naturism:{...info,status:'dedicated'}},
    {...listed,id:'unsourced',name:'Plage naturiste sans preuve',naturism:{status:'unknown'}}];
  await page.route('**/api/search/beaches', r => r.fulfill({json:searchResult(r.request().postDataJSON(),rows)}));
  await page.route('**/api/beaches/test-sea', r => r.fulfill({json:listed}));
  await page.goto('/recherche');
  const filters = page.getByRole('button',{name:/Filtres/}), choice = page.getByRole('combobox',{name:'Naturisme',exact:true});
  await filters.click();
  await choice.selectOption('verified');
  await expect(page.locator('.beach-result')).toHaveCount(2);
  await expect(page.locator('.naturism-label')).toHaveText(['Plage naturiste','Secteur naturiste']);
  await choice.selectOption('dedicated'); await expect(page.locator('.beach-result')).toHaveCount(1);
  await expect(page.locator('.beach-name')).toContainText('Autre plage');
  await choice.selectOption('section'); await expect(page).toHaveURL(/naturism=section/);
  await page.reload(); await expect(page.locator('.beach-result')).toHaveCount(1);
  await expect(filters).toContainText('1');
  await filters.click(); await expect(choice).toHaveValue('section');
  await page.getByRole('button',{name:'Réinitialiser'}).click();
  await expect(page.locator('.beach-result')).toHaveCount(3); await expect(page).not.toHaveURL(/naturism=/);
  await expect(page.locator('.beach-result').filter({hasText:'sans preuve'}).locator('app-naturism')).toHaveCount(0);
  await page.locator('.beach-result').filter({hasText:listed.name}).getByRole('link',{name:'Détails'}).click();
  const block = page.locator('#sur-place app-naturism');
  await expect(block.getByText(info.detail)).toBeVisible();
  await expect(block.getByRole('link',{name:info.source})).toHaveAttribute('href',info.sourceUrl);
  await expect(block).toContainText('21/11/2026'); await noOverflow(page);
  await page.route('**/api/beaches/test-sea', r => r.fulfill({json:{...listed,naturism:{status:'unknown'}}}));
  await page.reload(); await expect(block).toContainText('Aucune information vérifiée');
  await expect(block.locator('.naturism-label')).toHaveCount(0);
});
test('accès des chiens : badge en recherche, conditions et source sur la fiche, silence sans preuve', async ({page}) => {
  const access = { status:'conditional', detail:'Uniquement en laisse, avant 9 h.', source:'Gestionnaire de test',
    sourceUrl:'https://example.org/reglement', checkedOn:'2026-11-21' };
  const listed = {...beaches[0], dogAccess:access};
  const others = [
    {...beaches[1], waterType:'sea'},
    {...listed, id:'test-allowed', name:'Plage canine', dogAccess:{...access,status:'allowed'}},
    {...listed, id:'test-prohibited', name:'Plage interdite aux chiens', dogAccess:{...access,status:'prohibited'}},
  ];
  await page.route('**/api/search/beaches', r => r.fulfill({json:searchResult(r.request().postDataJSON(),[listed,...others])}));
  await page.goto('/recherche');
  await expect(page.locator('.beach-result')).toHaveCount(4);
  await expect(page.getByText('Chiens admis',{exact:true})).toBeVisible();
  await expect(page.getByText('Chiens de compagnie interdits',{exact:true})).toBeVisible();
  await expect(page.locator('.beach-result').filter({hasText:listed.name}).getByText('Chiens admis sous conditions')).toBeVisible();
  await expect(page.locator('.beach-result').filter({hasText:beaches[1].name}).locator('app-dog-access')).toHaveCount(0);
  await page.route('**/api/beaches/test-sea', r => r.fulfill({json:listed}));
  await page.locator('.beach-result').filter({hasText:listed.name}).getByRole('link',{name:'Détails'}).click();
  const block = page.locator('#sur-place app-dog-access');
  await expect(block.getByText(access.detail)).toBeVisible();
  await expect(block.getByRole('link',{name:access.source})).toHaveAttribute('href',access.sourceUrl);
  await expect(block).toContainText('21/11/2026');
  await noOverflow(page);
  await page.route('**/api/beaches/test-sea', r => r.fulfill({json:{...listed,dogAccess:{status:'unknown',reason:'conflict'}}}));
  await page.reload();
  await expect(block).toContainText('Non renseigné.');
  await expect(block).toContainText('Les sources se contredisent');
  await expect(block.locator('.dog-label')).toHaveCount(0);
});
test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test.describe('Dates civiles en France métropolitaine', () => {
  test.use({ timezoneId: 'Europe/Paris' });

  test('ARS : archive saisonnière et interdiction officielle distinctes', async ({page})=>{
    let closed=false;
    await page.route('**/api/score/beach/*',route=>route.fulfill({json:{...score,current:{...score.current,waterQuality:{
      archive:{siteName:'Capélan',season:2025,samplesUrl:'https://www.data.gouv.fr/',eventsUrl:'https://www.data.gouv.fr/',
        samples:[{date:'2025-07-10',ecoli:{value:15,qualifier:'detection-limit'},enterococci:{value:null,qualifier:'missing'}}],
        historicalClosures:[{from:'2025-06-24',to:'2025-06-26'}]},
      restriction:{status:closed?'closed':'unknown',decisions:closed?[{authority:'Ville de Bandol',active:true,closedOn:'2026-07-20',closureUrl:'https://www.bandol.fr/acte'}]:[]}
    }}}}));
    await page.goto('/plages/test-sea');
    const sources=page.locator('#sources');
    await expect(sources).toContainText('Dernier prélèvement le 10/07/2025');
    await expect(sources).toContainText('Interdictions archivées : 1');
    await expect(sources).toContainText('limite de détection : 15 / 100 ml');
    await expect(sources).toContainText('entérocoques (non renseigné)');
    await expect(sources).toContainText('Autorisation actuelle non confirmée');
    await expect(page.locator('.official-status')).toContainText('Drapeau officiel');
    closed=true;await page.reload();
    const warning = page.locator('.beach-heading').getByRole('link', {name:/Décision officielle.*Baignade interdite/});
    await expect(warning).toBeVisible();
    await warning.click();
    await expect(page).toHaveURL(/#sources$/);
    await expect(sources).toContainText('Baignade interdite par décision officielle');
    await expect(sources.getByRole('link',{name:/Ville de Bandol/})).toContainText('20/07/2026');
    await expect(sources.getByRole('link',{name:/Ville de Bandol/})).toHaveAttribute('href','https://www.bandol.fr/acte');
    await page.route('**/api/search/beaches',route=>route.fulfill({json:searchResult(route.request().postDataJSON(),
      [{...beaches[0],bathingRestriction:'closed',flag:'green',flagSource:'community'}])}));
    await page.goto('/recherche');
    await expect(page.locator('.bathing-status')).toContainText('Baignade interdite · décision officielle');
    await expect(page.locator('.bathing-status')).not.toContainText('Vert');
  });
});

test('drapeaux : filtre attribué, dernier rouge daté et aperçu indépendant de la météo', async ({page})=>{
  const recentRedAt = '2026-07-15T12:00:00Z';
  await page.route('**/api/search/beaches',route=>route.fulfill({json:searchResult(route.request().postDataJSON(),[
    {...beaches[0],flag:'green',flagSource:'community',recentRedAt},
    {...beaches[1],flag:'red',flagSource:null},
  ])}));
  await page.route('**/api/score/**',r=>r.fulfill({status:503,json:{}}));
  await page.goto('/recherche');
  await expect(page.locator('.beach-result')).toHaveCount(2);
  await expect(page.locator('#beach-test-river .bathing-status')).toHaveCount(0);
  await page.getByRole('button',{name:'Filtres',exact:true}).click();
  await page.getByLabel('Drapeau observé par la communauté').selectOption('green');
  await expect(page).toHaveURL(/flag=green/);
  await expect(page.locator('.beach-result')).toHaveCount(1);
  const result = page.locator('#beach-test-sea');
  await expect(result.locator('.bathing-status')).toContainText('Drapeau communautaire : Vert');
  await expect(result.locator('.bathing-status time')).toHaveAttribute('datetime',recentRedAt);
  const details = result.getByRole('link',{name:'Détails'});
  const status = await result.locator('.bathing-status').boundingBox();
  const link = await details.boundingBox();
  expect(status!.x + status!.width).toBeLessThanOrEqual(link!.x);
  await result.getByRole('button',{name:beaches[0].name}).click();
  await expect(result.locator('.notice.error')).toBeVisible();
  await expect(result.locator('.overview-flag')).toHaveText('Drapeau officiel non renseigné');
  await expect(page).toHaveURL(/recherche/);
  await page.getByLabel('Drapeau observé par la communauté').selectOption('yellow');
  await expect(page.getByRole('heading',{name:'Aucune plage pour ces critères'})).toBeVisible();
  await page.getByRole('button',{name:'Effacer les filtres',exact:true}).last().click();
  await expect(page.locator('.beach-result')).toHaveCount(2);
});

test.describe('Références UI-03', () => {
  test.use({timezoneId:'Europe/Paris', reducedMotion:'reduce'});
  test('quatre pages avec des données de démonstration isolées', async ({page}, info)=>{
    const asOf = '2026-07-15T13:00:00Z';
    await page.clock.setFixedTime(new Date(asOf));
    await page.route('https://tile.openstreetmap.org/**', route=>route.abort());
    await page.route('https://services.data.shom.fr/**', route=>route.abort());
    await page.route('**/api/search/beaches',route=>route.fulfill({json:{
      ...searchResult(route.request().postDataJSON(),[{...beaches[0],flag:'yellow',flagSource:'community'},beaches[1]]),asOf,
    }}));
    for (const [name, url, selector] of [
      ['accueil','/','app-ocean-scene'],
      ['recherche','/recherche','#beach-test-sea .bathing-status'],
      ['fiche','/plages/test-sea','.conditions-grid'],
      ['contact','/contact','textarea'],
    ]) {
      await page.goto(url);
      await expect(page.locator(selector)).toBeVisible();
      await page.evaluate(()=>document.fonts.ready);
      await noOverflow(page);
      if (name === 'recherche' && (page.viewportSize()?.width ?? 0) >= 1024) {
        await expect(page.locator('.leaflet-fallback-map-pane path').first()).toBeAttached();
        await expect(page.locator('.map-error')).toContainText('Fond de carte indisponible');
        const mapWidth = (await page.locator('.map-canvas').boundingBox())!.width;
        await expect.poll(async ()=>(await page.locator('.leaflet-fallback-map-pane svg').boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(mapWidth);
      }
      await page.screenshot({path:info.outputPath(name+'.jpg'),type:'jpeg',quality:78,scale:'css',animations:'disabled'});
    }
  });
});

test('Confort : le même profil et les mêmes points dans la liste et la fiche',async({page})=>{
  const family={version:'confort-2',score:68,status:'calculated',available:6,required:6,missing:[],factors:[{label:'Vagues',points:-32}]};
  const bathing={...family,score:null,status:'insufficient',available:5,missing:['Température de l’eau']};
  await page.route('**/api/search/beaches',route=>route.fulfill({json:searchResult(route.request().postDataJSON(),
    [{...beaches[0],selectedScore:68,scoreExplanation:family}])}));
  await page.route('**/api/score/beach/*',route=>route.fulfill({json:{...score,scores:{...score.scores,family:68,bathing:null},explanations:{family,bathing}}}));
  await page.goto('/recherche?usage=family');
  await expect(page.locator('.beach-tags')).toContainText('Confort : 68/100');
  await page.locator('.beach-result').getByRole('button',{name:'Plage des Pins',exact:true}).click();
  await expect(page.locator('.beach-overview')).toContainText('Vagues : 32 points retirés');
  await page.getByRole('link',{name:/Détails/}).first().click();
  await expect(page.locator('.score-explanation')).toContainText('Vagues : 32 points retirés');
  await page.getByRole('button',{name:/Baignade/}).first().click();
  await expect(page.locator('.score-explanation')).toContainText('5/6');
  await expect(page.locator('.score-explanation')).toContainText('Température de l’eau');
});

test('Disciplines : la note suit le sport sélectionné et la direction indique la provenance',async({page})=>{
  const e={version:'voile-loisir-1',score:85,status:'calculated',available:4,required:4,
    missing:[],invalid:[],stale:[],factors:[]};
  await page.route('**/api/score/beach/*',route=>route.fulfill({json:{...score,
    current:{...score.current,weather:{...score.current.weather,wind_direction_10m:270}},
    dataStatus:{...score.dataStatus,weather:{...airStatus,units:{wind_direction_10m:'°'}}},
    explanations:{paddle:{...e,score:43},catamaran:e,windsurf:{...e,score:null,partialScore:62,status:'partial',available:2}}}}));
  await page.goto('/plages/test-sea');
  await expect(page.locator('.wind-origin')).toHaveText('Provenance : ouest · 270°');
  const card=page.getByRole('button',{name:/Sports nautiques/});
  await card.click();
  const sports=page.getByLabel('Discipline nautique');
  await expect(card).toContainText('43');
  await sports.selectOption('catamaran');await expect(card).toContainText('85');
  await expect(page.locator('.score-explanation')).toContainText('85/100');
  await sports.selectOption('windsurf');await expect(card).toContainText('≤ 62');
  await expect(page.locator('.score-explanation')).toContainText('2/4');
  await noOverflow(page);
});

test('Confort partiel : plafond nul visible et vent/UV périmés distincts des valeurs absentes',async({page})=>{
  const e={version:'confort-3',status:'partial',score:null,partialScore:0,required:6,available:3,
    stale:['Vent','Indice UV'],missing:['Rafales'],invalid:[],factors:[{label:'Vagues',points:-88}]};
  await page.route('**/api/search/beaches',r=>r.fulfill({json:searchResult(r.request().postDataJSON(),
    [{...beaches[0],selectedScore:null,scoreExplanation:e}])}));
  await page.route('**/api/score/beach/*',r=>r.fulfill({json:{...score,
    dataStatus:{...score.dataStatus,weather:{...airStatus,status:'stale'}},scores:{...score.scores,bathing:null},explanations:{bathing:e}}}));
  await page.goto('/recherche');
  await expect(page.locator('.beach-tags')).toContainText('Confort partiel : 0/100 · 3/6 mesures');
  await page.getByRole('link',{name:/Détails/}).first().click();
  await expect(page.locator('.usage-scores button').first()).toContainText('Partiel · 3/6 mesures');
  await expect(page.locator('.score-explanation')).toContainText('Indice partiel : 0/100');
  await expect(page.locator('.score-explanation')).not.toContainText('pourraient abaisser');
  await expect(page.locator('.score-explanation')).toContainText('Prévisions périmées, exclues du calcul : Vent, Indice UV');
  await expect(page.locator('.score-explanation')).toContainText('Non renseigné : Rafales');
  await expect(page.locator('.conditions-grid > div').filter({hasText:'Indice UV'})).toContainText('Prévision périmée');
  await noOverflow(page);
});

test('Barème : accès depuis une fiche, coefficients et retour à la plage',async({page})=>{
  await page.goto('/plages/test-sea');
  await page.getByRole('link',{name:'Comprendre le barème'}).click();
  await expect(page).toHaveURL(/\/bareme$/);
  await expect(page.getByRole('heading',{name:'Comprendre le barème'})).toBeVisible();
  await expect(page.getByRole('row',{name:/Catamaran/})).toContainText('35');
  await expect(page.getByText(/chaque km\/h au-dessus/)).toBeVisible();
  await noOverflow(page);
  await page.goBack();
  await expect(page).toHaveURL(/\/plages\/test-sea$/);
});

test('Direction du vent : nord, calme et valeur inconnue restent distincts',async({page})=>{
  let degrees:number|null=0,speed=12;
  await page.route('**/api/score/beach/*',r=>r.fulfill({json:{...score,
    current:{...score.current,weather:{wind_speed_10m:speed,wind_direction_10m:degrees}},
    dataStatus:{...score.dataStatus,weather:{...airStatus,units:{wind_speed_10m:'km/h',wind_direction_10m:'°'}}}}}));
  await page.goto('/plages/test-sea');
  await expect(page.locator('.wind-origin')).toHaveText('Provenance : nord · 0°');
  degrees=360;await page.reload();await expect(page.locator('.wind-origin')).toHaveText('Provenance : nord · 0°');
  speed=0;await page.reload();await expect(page.locator('.wind-origin')).toHaveText('Vent calme · sans direction');
  speed=12;degrees=null;await page.reload();await expect(page.locator('.wind-origin')).toHaveText('Direction non renseignée');
});

test('SHOM : références du port distinctes des horaires et retrait à échéance', async ({page})=>{
  await page.clock.install({time:new Date('2026-11-18T22:59:45Z')});
  await page.route('**/api/score/beach/*', route=>route.fulfill({json:{...score,current:{...score.current,tides:{
    portReference:{name:'Calais',distanceKm:1,timetableUrl:'https://maree.shom.fr/harbor/CALAIS/'},
    heightReference:{lowestAstronomical:0.19,highestAstronomical:7.9,expiresAt:'2026-11-18T23:00:00Z'},
    currentReference:{vmaxClass:0,expiresAt:'2026-11-18T23:00:05Z'},
  }}}}));
  await page.goto('/plages/test-sea');
  const sources=page.locator('#sources');
  const link=sources.getByRole('link',{name:'Horaires Shom · Calais'});
  await expect(link).toHaveAttribute('href','https://maree.shom.fr/harbor/CALAIS/');
  await expect(sources).toContainText('0.19 à 7.9 m');
  await expect(sources).toContainText('VMAX 0 nd');
  await page.clock.fastForward(21000);
  await expect(sources).not.toContainText('Extrêmes astronomiques');
  await expect(sources).not.toContainText('VMAX');
  await expect(link).toBeVisible();
});

test('vigilance officielle : source et échéance indépendantes du score', async ({page}) => {
  await page.clock.install({time:new Date('2026-11-18T19:00:00Z')});
  let valid=true;
  await page.route('**/api/alerts?beachId=test-sea',route=>route.fulfill({json:valid ? {
    status:'available',department:'83',alerts:[{level:'orange'}],issuedAt:'2026-11-18T18:00:00Z',
    validFrom:'2026-11-18T19:00:00Z', validUntil:'2026-11-18T20:00:00Z', checkBy:'2026-11-18T19:01:00Z',
  } : {status:'unknown', alerts:[]}}));
  await page.goto('/plages/test-sea');
  const caption=page.locator('p.caption').filter({hasText:'Vagues-submersion'});
  await expect(caption).toContainText('vigilance orange sur le littoral 83');
  await expect(caption.getByRole('link')).toHaveAttribute('href','https://vigilance.meteofrance.fr/fr/vagues-submersion');
  valid=false; await page.clock.fastForward(61000);
  await expect(caption).toContainText('indisponible');
  await expect(caption).not.toContainText('orange');
});

test('prévisions : courant en m/s et interruption de courbe pour une mesure absente', async ({ page }) => {
  await page.route('**/api/score/beach/*', route => route.fulfill({ json: {
    ...score, measurements:{forecast:{current:[
      forecastPoint('2026-07-15T12:00:00Z',1,'open-meteo-marine','m/s'),
      forecastPoint('2026-07-15T13:00:00Z',null,'open-meteo-marine','m/s'),
      forecastPoint('2026-07-15T14:00:00Z',0,'open-meteo-marine','m/s'),
    ]}}, forecast: { current: [
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

test('prévisions : source unique par mesure, aucune interpolation ni reprise des points non attribués', async ({page})=>{
  await page.route('**/api/score/**',route=>route.fulfill({json:{...score,
    forecast:{...score.forecast,water:[{time:'2026-07-15T12:00:00Z',value:99}]},
    measurements:{forecast:{air:[
    forecastPoint('2026-07-15T12:00:00Z',0),forecastPoint('2026-07-15T14:00:00Z',17),
    forecastPoint('2026-07-15T15:00:00Z',99,'open-meteo-marine'),
    {...forecastPoint('2026-07-15T16:00:00Z',88),isDemo:true},
    forecastPoint('2026-07-15T17:00:00Z',77,'open-meteo','°F'),
    {...forecastPoint('2026-07-15T18:00:00Z',66),fetchedAt:'2026-07-14T11:45:00Z'},
  ]}}}}));
  await page.goto('/plages/test-sea');
  const chart=page.locator('#previsions');
  await expect(chart.locator('.chart-heading')).toContainText('Source unique : Open-Meteo');
  await expect(chart.locator('.forecast-chart circle')).toHaveCount(2);
  await expect(chart.locator('.forecast-chart svg path')).toHaveAttribute('d',/^M[^L]*M[^L]*$/);
  await chart.getByText('Valeurs détaillées').click();
  await expect(chart.locator('tbody tr').first()).toContainText('0 °C');
  await chart.getByRole('button',{name:'Eau',exact:true}).click();
  await expect(chart.locator('.forecast-chart svg')).toHaveCount(0);
  await expect(chart.getByRole('heading',{name:'Prévisions non disponibles'})).toBeVisible();
});

test('prévisions : une mesure marine reçue pour une rivière ne devient pas sa température',async({page})=>{
  await page.route('**/api/beaches/test-river',route=>route.fulfill({json:beaches[1]}));
  await page.route('**/api/score/**',route=>route.fulfill({json:{...score,beach:beaches[1],
    measurements:{forecast:{water:[forecastPoint('2026-07-15T12:00:00Z',19,'open-meteo-marine')]}}}}));
  await page.goto('/plages/test-river');
  const chart=page.locator('#previsions');
  await expect(page.getByRole('heading',{name:'Baignade en eau douce'})).toBeVisible();
  await expect(page.getByText('Autorisation de baignade non confirmée.',{exact:true})).toBeVisible();
  await expect(chart.getByRole('button',{name:'Eau',exact:true})).toHaveCount(0);
  await expect(page.locator('dt').filter({hasText:'Marées'})).toHaveCount(0);
  await expect(page.getByText('Hauteur des vagues',{exact:true})).toHaveCount(0);
  await expect(page.locator('.usage-scores')).toHaveCount(0);
  await expect(chart.locator('.forecast-chart svg')).toHaveCount(0);
});

test('lac : une fermeture officielle reste visible en l’absence de modèle marin', {tag: '@beta'}, async({page})=>{
  const lake={...beaches[1],id:'test-lake',waterType:'lake'};
  await page.route('**/api/beaches/test-lake',r=>r.fulfill({json:lake}));
  await page.route('**/api/score/**',r=>r.fulfill({json:{...score,beach:lake,current:{...score.current,
    waterQuality:{status:'closed',restriction:{status:'closed',decisions:[]}}}}}));
  await page.goto('/plages/test-lake');
  await expect(page.locator('.usage-section')).toContainText('Baignade interdite par décision officielle.');
  await expect(page.locator('.usage-section')).not.toContainText('Autorisation de baignade non confirmée');
  await expect(page.locator('dt').filter({hasText:'Marées'})).toHaveCount(0);
  await noOverflow(page);
});

test('prévisions : actualisation automatique à expiration même si le prochain contrôle est repoussé',async({page})=>{
  await page.clock.install({time:new Date('2026-07-15T17:44:50Z')});
  let requests=0;
  let release!:()=>void;
  const pending=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/score/**',async route=>{
    requests++;
    if(requests===2) await pending;
    return route.fulfill({json:{...score,dataStatus:{weather:{...airStatus,
      status:requests===1?'available':'stale',validAt:'2026-07-15T18:00:00Z',nextCheckAt:'2026-07-15T20:00:00Z'}}}});
  });
  await page.goto('/plages/test-sea');
  await expect(page.locator('.chart-heading')).toContainText('Open-Meteo');
  await page.locator('.beach-heading').evaluate(el=>el.setAttribute('data-original','yes'));
  try {
    await page.clock.fastForward(11000);
    await expect.poll(()=>requests).toBe(2);
    await expect(page.locator('app-loading')).toHaveCount(0);
    await expect(page.locator('.conditions-grid')).toBeVisible();
  } finally {release();}
  await expect(page.locator('.chart-heading')).toContainText('périmée');
  await expect(page.locator('.beach-heading')).toHaveAttribute('data-original','yes');
});

test('actualisation discrète : une fiche ouverte ne lance pas de vague pour ses appels secondaires',async({page})=>{
  let release!:()=>void;
  const pending=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/beaches/test-sea/amenities',async route=>{
    await pending;return route.fulfill({json:{amenities:[],status:'unknown'}});
  });
  await page.route('**/api/score/**',async route=>{await pending;return route.fulfill({status:503,json:{}});});
  await page.goto('/plages/test-sea');
  try {
    await expect(page.getByRole('heading',{name:'Plage des Pins',exact:true})).toBeVisible();
    await expect(page.locator('#conditions')).toContainText('Lecture des conditions');
    await expect(page.locator('#sur-place')).toContainText('Recherche des équipements');
    await expect(page.locator('app-loading')).toHaveCount(0);
  } finally {release();}
  await expect(page.locator('#conditions')).toContainText('Conditions indisponibles');
  await expect(page.locator('#communaute')).toBeVisible();
});

test('actualisation discrète : panne puis reprise sans perdre les prévisions ni conserver les anciens scores', async({page})=>{
  await page.clock.install({time:new Date('2026-07-15T12:00:00Z')});
  let attempt=0, release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/score/**',async route=>{
    attempt++;
    if(attempt===2)return route.fulfill({status:503,json:{}});
    if(attempt===3)await gate;
    return route.fulfill({json:{...score,dataStatus:{weather:{...airStatus,nextCheckAt:'2026-07-15T12:00:10Z'}}}});
  });
  await page.goto('/plages/test-sea');
  await expect(page.locator('.usage-scores strong').first()).toContainText('/100');
  await page.clock.fastForward(11000);
  await expect(page.locator('#conditions')).toContainText('Dernières prévisions connues');
  await expect(page.locator('.conditions-grid strong').first()).toContainText('24');
  await expect(page.locator('.usage-scores strong')).toHaveText(['—','—','—','—']);
  await expect(page.locator('.chart-heading')).toContainText('périmée');
  try {
    await page.getByRole('button',{name:'Réessayer'}).click();
    await expect.poll(()=>attempt).toBe(3);
    await expect(page.locator('app-loading')).toHaveCount(0);
    await expect(page.locator('.conditions-grid')).toBeVisible();
  } finally {release();}
  await expect(page.locator('.usage-scores strong').first()).toContainText('/100');
  await expect(page.getByRole('button',{name:'Réessayer'})).toHaveCount(0);
});

test('actualisation discrète : un filtre conserve la liste pendant la requête, sans vague ni ancienne action',async({page})=>{
  let release!:()=>void;
  const pending=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/search/beaches',async route=>{
    const input=route.request().postDataJSON();
    if(input.parking) await pending;
    return route.fulfill({json:searchResult(input,beaches)});
  });
  await page.goto('/recherche');
  await expect(page.locator('.beach-result')).toHaveCount(2);
  await page.getByRole('button',{name:'Filtres',exact:true}).click();
  try {
    await page.getByLabel('Parking',{exact:true}).check();
    await expect(page.locator('.results-column')).toHaveAttribute('aria-busy','true');
    await expect(page.locator('.beach-result[inert]')).toHaveCount(2);
    await expect(page.locator('app-loading')).toHaveCount(0);
    await expect(page.locator('.results-heading')).toContainText('Mise à jour');
  } finally {release();}
  await expect(page.locator('.beach-result')).toHaveCount(1);
  await expect(page.locator('.beach-result[inert]')).toHaveCount(0);
  await expect(page.locator('.beach-name')).toContainText('Plage des Pins');
});

test('conditions : panne fournisseur sans faux score ni courbe', async ({ page }) => {
  await page.route('**/api/score/beach/*', route => route.fulfill({ json: {
    ...score, scores: { bathing: null, family: null, paddle: null, boat: null },
    current: { weather: { temperature_2m: null, uv_index: null }, marine: {} },
    forecast: { air: [], water: [], uv: [], wave: [] }, measurements:{forecast:{}},
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
    dataStatus: { weather: { ...airStatus,status: 'stale', ageSeconds: 1800, validAt: '2026-07-15T13:00:00Z' }, marine: { status: 'partial', ageSeconds: 60 } },
  } }));
  await page.goto('/plages/test-sea');
  await expect(page.getByText(/Prévisions périmées.*collecte :.*échéance :/)).toBeVisible();
  await expect(page.locator('.conditions-grid strong').first()).toContainText('0');
  await expect(page.locator('.forecast-chart svg path')).toHaveCount(1);
  await noOverflow(page);
});

test('recherche : catalogue complet au-dela de 180 et 500 plages', async ({ page }) => {
  const catalogue = Array.from({ length: 602 }, (_, i) => ({
    ...beaches[0], id: `page-${i}`, name: `Escale ${String(i).padStart(4, '0')}`,
  }));
  const cursors: number[] = [];
  await page.route('**/api/search/beaches', (route) => {
    const input=route.request().postDataJSON();
    const start = Number(input.cursor || 0);
    cursors.push(start);
    return route.fulfill({ json: searchResult(input,catalogue) });
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
  await page.route('**/api/search/beaches', route => {
    const after = route.request().postDataJSON().cursor ?? null;
    cursors.push(after);
    return route.fulfill({ json: {
      ...searchResult({},beaches),
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
    { ...beaches[0], id: 'test-lake', name: 'Plage du lac sale', waterType: 'lake', coastline: 'Atlantique',department:'Atlantique' },
    { ...beaches[0], id: 'test-unknown', name: 'Site non classe', waterType: 'unknown' },
  ];
  await page.route('**/api/search/beaches', route => route.fulfill({ json: searchResult(route.request().postDataJSON(),catalogue) }));
  await page.goto('/recherche');
  await expect(page.locator('.beach-result')).toHaveCount(4);
  await page.getByRole('button', { name: 'Filtres', exact: true }).click();
  const sections=page.getByRole('navigation',{name:'Milieu de baignade'});
  for (const [section, type, name] of [['Mer','sea', 'Plage de La Baule'], ['Lacs','lake', 'Plage du lac sale'], ['Rivières','river', 'Berge de test']]) {
    await sections.getByRole('link',{name:section,exact:true}).click();
    await expect(page).toHaveURL(new RegExp('water='+type));
    await expect(sections.getByRole('link',{name:section,exact:true})).toHaveAttribute('aria-current','page');
    await expect(page.locator('.beach-result')).toHaveCount(1);
    await expect(page.locator('.beach-name').getByRole('button', { name, exact: true })).toBeVisible();
    if(type!=='sea'){
      await expect(page.locator('.beach-name p')).not.toContainText('Atlantique');
      await expect(page.getByLabel('Façade géographique')).toHaveCount(0);
      await expect(page.locator('.zone-marker')).toHaveCount(0);
      await expect(page.locator('.shoreline-tiles')).toHaveCount(0);
    }
  }
  await sections.getByRole('link',{name:'Tous',exact:true}).click();
  await expect(page.locator('.beach-result')).toHaveCount(4);
  await noOverflow(page);
});

test("recherche : filtres, apercu distinct et retour", {tag: '@beta'}, async ({
  page,
}, info) => {
  await page.goto("/recherche");
  await expect(page.locator(".beach-result")).toHaveCount(2);
  await page.getByRole("button", { name: "Filtres", exact: true }).click();
  await page.getByRole('navigation',{name:'Milieu de baignade'}).getByRole('link',{name:'Rivières'}).click();
  await expect(page.locator(".beach-result")).toHaveCount(1);
  await expect(page.locator(".beach-name")).toContainText("Berge des Saules");
  await page.getByRole('navigation',{name:'Milieu de baignade'}).getByRole('link',{name:'Tous'}).click();
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
  await expect(page.getByRole('link',{name:/Itinéraire vers Parking du port/})).toHaveCount(0);
  await page.locator('.amenity-group summary').filter({hasText:'Stationnement'}).press('Enter');
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

test('drapeaux : majorite verte, historique rouge et alertes restent separes', async ({page},info) => {
  const community={flag:'green',status:'consensus',participants:6,agreement:.83,confidence:.83,counts:{green:5,yellow:0,red:1},
    recentRedAt:'2026-07-15T12:00:00Z',history:[{flag:'green',time:'2026-07-15T13:00:00Z',confidence:0},{flag:'red',time:'2026-07-15T12:00:00Z',confidence:0}]};
  await page.route('**/api/score/**',route=>route.fulfill({json:{...score,safety:{flag:'red',official:false,communityFlag:community,alerts:['Mer agitée','Qualité d’eau défavorable']}}}));
  await page.goto('/plages/test-sea');
  await expect(page.locator('.community-flags')).toContainText('Observation majoritaire : Vert');
  await expect(page.locator('.community-flags')).toContainText('Dernier rouge signalé');
  await expect(page.locator('.community-flags')).not.toContainText('%');
  await expect(page.locator('.official-status')).toContainText('Non renseigné');
  await expect(page.locator('.alerts')).toContainText('Mer agitée');
  await expect(page.locator('.alerts')).toContainText('Qualité d’eau défavorable');
  await page.getByText('Historique récent des drapeaux',{exact:true}).click();
  await expect(page.locator('.community-flags .report-row')).toHaveCount(2);
  await expect(page.locator('.community-flags .report-row').last()).toContainText('Rouge');
  await noOverflow(page);
  await page.locator('.community-flags').screenshot({path:info.outputPath('community-flags.png')});
});

test('hub : attente, publication, contestation privée, retrait et expiration sans rechargement',async({page})=>{
  const now=Date.parse('2026-11-19T12:00:00Z');
  await page.clock.install({time:new Date(now)});
  const id='20000000-0000-4000-8000-000000000001';
  const at=(ms:number)=>new Date(now+ms).toISOString();
  const report={id,beach_id:beaches[0].id,type:'flag',value:{flag:'red'},status:'verified',
    created_at:at(0),observed_at:at(0),expires_at:at(86400000),provenance:{verified:true,isDemo:false}};
  let published=false, withdrawn=false, expiring=false, lastBody:any,unlock!:()=>void;
  const gate=new Promise<void>(resolve=>unlock=resolve);
  await page.route('**/api/reports?*',async route=>{
    await gate;
    return route.fulfill({json:expiring?[{...report,id:'20000000-0000-4000-8000-000000000002',
      type:'pollution',value:{},expires_at:at(131000)}]:published&&!withdrawn?[report]:[]});
  });
  await page.route('**/api/reports',route=>{
    lastBody=route.request().postDataJSON();return route.fulfill({status:201,json:{...report,status:'pending'}});
  });
  await page.route('**/api/score/**',route=>route.fulfill({json:{...score,safety:{...score.safety,
    communityFlag:published&&!withdrawn?{participants:1,counts:{red:1,green:0,yellow:0},flag:null,
      history:[{reportId:id,flag:'red',time:at(0),confidence:0}]}:null}}}));
  await page.goto('/plages/test-sea');
  const hub=page.locator('#communaute');
  await expect(hub.locator('.badge')).toHaveText('Chargement…');
  unlock();
  await hub.getByText('Signaler un drapeau observé').click();
  await hub.getByRole('button',{name:'Rouge'}).click();
  await expect(hub.getByRole('status')).toContainText('attente de modération');
  await expect(hub.locator('.report-row')).toHaveCount(0);
  published=true;
  await page.clock.fastForward(61000);
  await hub.getByText('Historique récent des drapeaux').click();
  await expect(hub.locator('.report-row')).toHaveCount(1);
  await hub.getByRole('button',{name:'Contester'}).click();
  await expect(hub.getByRole('status')).toContainText('Contestation reçue');
  expect(lastBody).toMatchObject({type:'other',value:{contests:id}});
  withdrawn=true;expiring=true;
  await page.clock.fastForward(61000);
  await expect(hub.locator('.community-flags')).toHaveCount(0);
  await expect(hub.locator('.report-row')).toContainText('Pollution signalée');
  await page.clock.fastForward(11000);
  await expect(hub.locator('.report-row')).toHaveCount(0);
  await expect(hub.locator('.badge')).toHaveText('0 observations');
  await noOverflow(page);
});

test('bulletin local : lecture volontaire, retour à la source et priorité à la fermeture',async({page})=>{
  const bulletin={provider:'plages-landes',publisher:'Landes Attractivité',zone:'Plage de la Piste · Capbreton',
    widgetId:560,sourceUrl:'https://www.plages-landes.info/plages/plage-de-la-piste/',linkVerifiedOn:'2026-11-23'};
  const site={...beaches[0],name:'Plage de la Piste',officialFlagBulletin:bulletin};
  const communityFlag={flag:'green',status:'consensus',participants:5,history:[],counts:{green:5,yellow:0,red:0}};
  let closed=false, requests=0;
  await page.clock.install({time:new Date('2026-11-23T10:00:00Z')});
  await page.route('**/api/beaches/test-sea',r=>r.fulfill({json:site}));
  await page.route('**/api/score/**',r=>r.fulfill({json:{...score,beach:site,safety:{...score.safety,communityFlag},
    current:{...score.current,waterQuality:{restriction:{status:closed?'closed':'unknown',decisions:[]}}}}}));
  await page.route('https://www.plages-landes.info/widget-plages-des-landes/**',r=>{
    requests++;expect(new URL(r.request().url()).searchParams.get('plgs')).toBe('560');
    expect(r.request().headers()['referer']).toBeUndefined();
    return r.fulfill({contentType:'text/html',body:'<h2>Bulletin de recette</h2>'});
  });
  await page.goto('/plages/test-sea');
  await page.locator('.official-status').click();
  await expect(page).toHaveURL(/#bulletin-sauveteurs$/);
  const panel=page.locator('#bulletin-sauveteurs');
  await expect(panel).toContainText(bulletin.zone);
  await expect(panel.getByRole('link')).toHaveAttribute('href',bulletin.sourceUrl);
  await expect(panel.locator('iframe')).toHaveCount(0);
  expect(requests).toBe(0);
  await panel.getByRole('button').click();
  await expect(page.frameLocator('#bulletin-sauveteurs iframe').getByRole('heading')).toHaveText('Bulletin de recette');
  expect(requests).toBe(1);
  await page.clock.fastForward(300001);
  await expect(panel.locator('iframe')).toHaveCount(0);
  await expect(panel.getByRole('button')).toHaveAttribute('aria-expanded','false');
  closed=true;await page.reload();
  await expect(page.locator('.official-status')).toContainText('Baignade interdite');
  await expect(panel).toHaveCount(0);
  await expect(page.locator('.community-flags')).toContainText('Observation majoritaire : Vert');
  expect(requests).toBe(1);
});

test('drapeaux : un vert isole reste sans majorite',async({page})=>{
  await page.route('**/api/score/**',route=>route.fulfill({json:{...score,safety:{...score.safety,
    communityFlag:{flag:null,status:'insufficient',participants:1,agreement:null,confidence:0,counts:{green:1,yellow:0,red:0},history:[]}}}}));
  await page.goto('/plages/test-sea');
  await expect(page.locator('.community-flags')).toContainText('Pas de majorité suffisamment étayée');
  await expect(page.locator('.community-flags')).not.toContainText('%');
  await noOverflow(page);
});

test('contributions : session reutilisee, confiance absente et moderation explicite', async ({page}) => {
  let sessions=0;
  const payloads: any[]=[];
  await page.route('**/api/reports/session',route=>{
    sessions++;
    return route.fulfill({status:201,json:{token:'b'.repeat(64),expiresAt:'2099-01-01T00:00:00Z'}});
  });
  await page.route('**/api/reports',route=>{
    payloads.push(route.request().postDataJSON());
    expect(route.request().headers()['authorization']).toBe('Bearer '+'b'.repeat(64));
    return route.fulfill({status:201,json:{status:'pending',confidence:0}});
  });
  await page.goto('/plages/test-sea');
  await page.getByRole('button',{name:'Méduses',exact:true}).click();
  await expect(page.getByText('Observation reçue, en attente de modération. Merci.')).toBeVisible();
  await page.getByRole('button',{name:'Pollution',exact:true}).click();
  await expect.poll(()=>payloads.length).toBe(2);
  expect(sessions).toBe(1);
  expect(payloads.every(p=>p.confidence===undefined&&p.value.source===undefined&&p.observedAt)).toBeTruthy();
  await noOverflow(page);
});

test('contributions : doublon et quota produisent des erreurs actionnables', {tag: '@beta'}, async ({page}) => {
  let status=409;
  await page.route('**/api/reports',route=>route.fulfill({status,json:{code:status===409?'CONFLICT':'RATE_LIMITED'}}));
  await page.goto('/plages/test-sea');
  await page.getByRole('button',{name:'Méduses',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('déjà été reçue');
  status=429;
  await page.getByRole('button',{name:'Méduses',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Veuillez patienter');
  await noOverflow(page);
});

test('equipements : homonymes distincts, sections repliées et itinéraire vers le GPS exact', async ({ page }) => {
  const points = Array.from({length:8}, (_,i)=>({id:`node/${i+1}`,name:'Parking du port',category:'parking',
    lat:43.08+i*.0001,lon:6.15,distanceKm:i*.01,source:'openstreetmap',verification:'listed'}));
  await page.route('**/api/beaches/test-sea/amenities',route=>route.fulfill({json:{beachId:'test-sea',
    provider:'openstreetmap-overpass',radiusMeters:2500,status:'stale',fetchedAt:'2026-11-16T12:00:00Z',total:8,amenities:points}}));
  await page.goto('/plages/test-sea');
  await expect(page.locator('.amenity-group p')).toHaveCount(8);
  const list=page.locator('.amenity-group').filter({has:page.locator('summary',{hasText:'Stationnement'})});
  await expect(list.locator('p').first()).toBeHidden();
  await list.locator('summary').press('Space');
  await expect(list.getByRole('link')).toHaveCount(8);
  await expect(list.getByRole('link').first()).toHaveAttribute('href','https://www.google.com/maps/dir/?api=1&destination=43.08%2C6.15');
  await list.locator('summary').press('Enter');
  await expect(list.locator('p').first()).toBeHidden();
  await expect(page.getByText('Relevé ancien',{exact:false})).toBeVisible();
  await expect(page.getByText('Ouverture et surveillance en service non confirmées.',{exact:false})).toBeVisible();
  await noOverflow(page);
});

test('equipements : le filtre poste de secours ne pretend pas confirmer la surveillance', async ({ page }) => {
  const presence={value:true,status:'present',source:'openstreetmap',verified:false,fetchedAt:'2026-11-17T12:00:00Z',scope:'nearby'};
  const catalogue=[{...beaches[0],has_lifeguard:null,facilities:{rescueStation:presence}},beaches[1]];
  await page.route('**/api/search/beaches',route=>route.fulfill({json:searchResult(route.request().postDataJSON(),catalogue)}));
  await page.goto('/recherche');
  await expect(page.locator('.beach-result')).toHaveCount(2);
  await page.getByRole('button',{name:'Filtres',exact:true}).click();
  await page.getByLabel('Poste de secours',{exact:true}).check();
  await expect(page.locator('.beach-result')).toHaveCount(1);
  await expect(page.locator('.beach-name')).toContainText('Plage des Pins');
  await noOverflow(page);
});

test('carte : équipements superposés, filtres indépendants et provenance au clavier', async ({page}) => {
  const point = {lat:43.0805,lon:6.152,distanceKm:0.2,source:'openstreetmap',verification:'listed'};
  const amenities = [
    {...point,id:'p1',category:'parking',name:'Parking du port'},
    {...point,id:'p2',category:'parking',name:'Parking du port'},
    {...point,id:'p1',category:'parking',name:'Parking du port'},
    {...point,id:'t1',category:'toilets',name:'Sanitaires du port'},
    {...point,id:'x',category:'parking',name:'Point non confirmé',verification:'to_verify'},
  ];
  await page.route('**/api/beaches/test-sea/amenities',r=>r.fulfill({json:{amenities,provider:'openstreetmap',status:'available'}}));
  await page.route('https://tile.openstreetmap.org/**',r=>r.abort());
  await page.goto('/plages/test-sea');
  const map=page.locator('app-coast-map'), layers=map.locator('summary');
  await expect(map.getByRole('status')).toContainText('Fond de carte indisponible');
  await expect(map.getByRole('button',{name:'2 équipements'})).toBeVisible();
  await layers.press('Enter');
  const parking=map.getByRole('checkbox',{name:'Stationnement (1)'});
  await parking.uncheck();
  await expect(map.locator('.map-point-cluster')).toHaveCount(0);
  await expect(page.locator('.amenity-group p')).toHaveCount(2);
  await expect(page.locator('.amenity-group p').filter({hasText:'Parking du port'})).toContainText('2 références OSM');
  await layers.press('Enter');
  const toilet=map.getByRole('button',{name:'Équipement : Sanitaires du port'});
  await toilet.press('Enter');
  await expect(map.locator('.leaflet-popup-content')).toContainText('Toilettes · OpenStreetMap');
  await map.locator('.leaflet-popup-close-button').click();
  await layers.press('Enter');await parking.check();await layers.press('Enter');
  await map.getByRole('button',{name:'2 équipements'}).press('Enter');
  await expect(map.getByRole('button',{name:'Équipement : Parking du port'})).toHaveCount(1);
  await expect(page.getByText('Point non confirmé')).toHaveCount(0);
  await noOverflow(page);
});

test('carte : plages au même emplacement sélectionnables sans ouvrir la fiche', async ({page})=>{
  const twins=[beaches[0],{...beaches[0],id:'test-twin',name:'Crique des Pins'}];
  await page.route('**/api/search/beaches',r=>r.fulfill({json:searchResult(r.request().postDataJSON(),twins)}));
  await page.goto('/recherche?zone=azur');
  if ((page.viewportSize()?.width ?? 1440)<761) await page.getByRole('button',{name:'Carte',exact:true}).click();
  const map=page.locator('app-coast-map');
  await map.getByRole('button',{name:'2 plages'}).press('Enter');
  await map.getByRole('button',{name:'Plage : Crique des Pins'}).press('Enter');
  await expect(page.locator('.beach-result.selected .beach-name button[aria-expanded=true]')).toHaveText('Crique des Pins');
  await expect(page).toHaveURL(/recherche/);
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
  await page.route("**/api/search/beaches", (route) =>
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

test("carte : facade selectionnable et reperes visibles", {tag: '@beta'}, async ({ page }) => {
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
