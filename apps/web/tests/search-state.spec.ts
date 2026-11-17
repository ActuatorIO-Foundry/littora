import { expect, test, Page } from './fixtures';

const a = { id:'state-a', name:'Plage Alpha', city:'Bandol', department:'Var', region:'Provence',
  coastline:'Mediterranee', waterType:'sea', lat:43.14, lon:5.76,
  has_parking:true, has_toilets:true, has_lifeguard:null, distanceKm:2 };
const b = { ...a, id:'state-b', name:'Plage Beta', has_parking:false, distanceKm:1 };
const conditions = (beach=a, temperature=24) => ({ beach,
  scores:{bathing:60,family:50,paddle:40,boat:30},
  current:{weather:{temperature_2m:temperature},marine:{sea_surface_temperature:19}},
  providers:{weather:'open-meteo'}, safety:{flag:null,official:false,alerts:[]}, forecast:{} });

async function api(page: Page) {
  await page.route('**/api/**', route => {
    const path=new URL(route.request().url()).pathname;
    if(path.includes('/score/'))return route.fulfill({json:conditions(path.endsWith(b.id)?b:a,path.endsWith(b.id)?18:24)});
    if(path.endsWith('/amenities'))return route.fulfill({json:{beachId:path.includes(b.id)?b.id:a.id,amenities:[],status:'unknown'}});
    if(path.endsWith('/reports')||path.startsWith('/api/places/'))return route.fulfill({json:[]});
    if(path.endsWith('/discover'))return route.fulfill({json:{provider:'local-catalogue',imported:0,beaches:[a,b]}});
    if(path.endsWith('/catalogue'))return route.fulfill({json:{beaches:[a,b],nextCursor:null}});
    if(path.startsWith('/api/beaches/'))return route.fulfill({json:path.endsWith(b.id)?b:a});
    return route.fulfill({json:[a,b]});
  });
}

async function controlledGps(page: Page) {
  await page.addInitScript(() => {
    const callbacks: Array<{success: PositionCallback; error?: PositionErrorCallback | null}> = [];
    Object.defineProperty(navigator,'geolocation',{configurable:true,value:{
      getCurrentPosition:(success: PositionCallback,error?: PositionErrorCallback|null)=>callbacks.push({success,error}),
    }});
    (window as any).__locationCallbacks=callbacks;
  });
}
async function resolveGps(page: Page, lat=43.14, lon=5.76) {
  await page.evaluate(({lat,lon})=>(window as any).__locationCallbacks.at(-1).success({coords:{latitude:lat,longitude:lon}}),{lat,lon});
}
test.beforeEach(async({page})=>api(page));

test('recherche: un GPS tardif ne remplace pas une facade choisie manuellement',async({page})=>{
  await controlledGps(page);let recommendations=0;
  page.on('request',r=>{if(r.url().includes('/recommendations'))recommendations++;});
  await page.goto('/recherche');await page.getByRole('button',{name:'Autour de moi'}).click();
  await page.getByRole('combobox',{name:/Fa/}).selectOption('bretagne');
  await expect(page).toHaveURL(/zone=bretagne/);await resolveGps(page);
  await page.evaluate(()=>(window as any).__locationCallbacks[0].error({code:3}));
  await expect(page.getByRole('combobox',{name:/Fa/})).toHaveValue('bretagne');
  await expect(page.getByRole('button',{name:'Autour de moi'})).toBeEnabled();
  expect(recommendations).toBe(0);
  await expect(page.getByText(/Position non disponible/)).toHaveCount(0);
});

test('recherche: saisie et reset annulent aussi une localisation en attente',async({page})=>{
  await controlledGps(page);let recommendations=0;
  page.on('request',r=>{if(r.url().includes('/recommendations'))recommendations++;});
  await page.goto('/recherche');await page.getByRole('button',{name:'Autour de moi'}).click();
  await page.getByRole('combobox',{name:'Rechercher dans les plages'}).fill('Alpha');
  await resolveGps(page);await expect(page.locator('.beach-result')).toHaveCount(1);
  await expect(page.locator('.beach-name')).toContainText('Plage Alpha');
  await page.getByRole('button',{name:'Autour de moi'}).click();
  await page.getByRole('button',{name:'Filtres',exact:true}).click();
  await page.getByRole('button',{name:/initialiser/}).click();await resolveGps(page);
  await expect(page.locator('.beach-result')).toHaveCount(2);expect(recommendations).toBe(0);
});

test('recherche: coordonnees invalides sans recommandation ni fausse position',async({page})=>{
  await controlledGps(page);let recommendations=0;
  page.on('request',r=>{if(r.url().includes('/recommendations'))recommendations++;});
  await page.goto('/recherche');await page.getByRole('button',{name:'Autour de moi'}).click();
  await resolveGps(page,95,0);
  await expect(page.getByRole('status')).toContainText('Position non disponible');
  await expect(page.locator('.beach-result')).toHaveCount(2);expect(recommendations).toBe(0);
});

test('recherche: un ancien catalogue ne remplace pas la derniere zone',async({page})=>{
  let release!:()=>void;const gate=new Promise<void>(r=>release=r);let calls=0;
  await page.route('**/api/beaches/catalogue?*',async route=>{
    const first=++calls===1;if(first)await gate;
    await route.fulfill({json:{beaches:first?[a]:[b],nextCursor:null}});
  });
  await page.goto('/recherche');await expect.poll(()=>calls).toBe(1);
  await page.getByRole('combobox',{name:/Fa/}).selectOption('azur');
  await expect(page.locator('.beach-name')).toContainText('Plage Beta');release();
  await expect(page.locator('.beach-name')).toContainText('Plage Beta');
  await expect(page.locator('.beach-result')).toHaveCount(1);
});

test('recherche: apercus concurrents et filtre ne gardent pas les conditions precedentes',async({page})=>{
  let release!:()=>void;const gate=new Promise<void>(r=>release=r);let started=false;
  await page.route('**/api/score/beach/state-a',async route=>{started=true;await gate;await route.fulfill({json:conditions(a,33)});});
  await page.goto('/recherche');await page.getByRole('button',{name:a.name,exact:true}).click();
  await expect.poll(()=>started).toBe(true);
  await page.getByRole('button',{name:b.name,exact:true}).click();
  await expect(page.locator('.overview-metrics')).toContainText('18');release();
  await expect(page.locator('.beach-result.selected')).toContainText(b.name);
  await expect(page.locator('.overview-metrics')).not.toContainText('33');
  await page.getByRole('button',{name:'Filtres',exact:true}).click();
  await page.getByLabel('Parking',{exact:true}).check();
  await expect(page.locator('.beach-overview')).toHaveCount(0);
});

test('recherche: une reponse portant le mauvais identifiant reste indisponible',async({page})=>{
  await page.route('**/api/score/beach/state-a',route=>route.fulfill({json:conditions(b,38)}));
  await page.goto('/recherche');await page.getByRole('button',{name:a.name,exact:true}).click();
  await expect(page.locator('.beach-overview')).toContainText('Conditions indisponibles');
  await expect(page.locator('.overview-metrics')).toHaveCount(0);
});

test('detail: la casse du UUID partage ne change pas son identite',async({page})=>{
  const id='abcdefab-1234-4000-8000-abcdefabcdef';const beach={...a,id};
  await page.route('**/api/beaches/'+id.toUpperCase(),route=>route.fulfill({json:beach}));
  await page.route('**/api/score/beach/'+id.toUpperCase(),route=>route.fulfill({json:conditions(beach)}));
  await page.goto('/plages/'+id.toUpperCase());
  await expect(page.locator('.conditions-grid strong').first()).toContainText('24');
});

test('recherche: filtres, tri, lien partage, retour et navigation sur la meme page',async({page})=>{
  const url='/recherche?zone=azur&water=sea&parking=1&usage=family&sort=distance';
  await page.goto(url);await expect(page.locator('.beach-result')).toHaveCount(1);
  await expect(page.getByRole('combobox',{name:'Trier les plages'})).toHaveValue('distance');
  await page.getByRole('link',{name:/D.tails/,exact:true}).click();
  await expect(page.getByRole('heading',{name:a.name,exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Retour aux plages'}).click();
  await expect(page.locator('.beach-result')).toHaveCount(1);await expect(page).toHaveURL(/parking=1/);
  await page.reload();await expect(page.getByRole('combobox',{name:'Trier les plages'})).toHaveValue('distance');
  await page.evaluate(()=>{
    history.pushState({navigationId:999},'','/recherche?zone=bretagne&sort=name');
    dispatchEvent(new PopStateEvent('popstate',{state:history.state}));
  });
  await expect(page.getByRole('combobox',{name:/Fa/})).toHaveValue('bretagne');
  await expect(page.locator('.beach-result')).toHaveCount(2);
  await page.goBack();await expect(page.getByRole('combobox',{name:/Fa/})).toHaveValue('azur');
  await expect(page.locator('.beach-result')).toHaveCount(1);
});

test('recherche: proximite conservee au retour et au rechargement sans coordonnees dans le lien',async({page,context})=>{
  await controlledGps(page);let calls=0;
  await page.route('**/api/recommendations*',route=>{calls++;return route.fulfill({json:[a]});});
  await page.goto('/recherche');await page.getByRole('button',{name:'Autour de moi'}).click();await resolveGps(page);
  await expect(page).toHaveURL(/near=1/);await expect(page.locator('.beach-result')).toHaveCount(1);
  expect(page.url()).not.toMatch(/43\.14|5\.76|lat=|lon=/);
  await page.getByRole('link',{name:/D.tails/,exact:true}).click();
  await page.getByRole('link',{name:'Retour aux plages'}).click();
  await expect.poll(()=>calls).toBe(2);await expect(page.locator('.beach-result')).toHaveCount(1);
  await page.reload();await expect.poll(()=>calls).toBe(3);await expect(page.locator('.beach-result')).toHaveCount(1);
  const shared=await context.newPage();const origin=new URL(page.url()).origin;
  await shared.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await api(shared);await shared.goto(page.url());
  await expect(shared.locator('.notice[role="status"]')).toContainText('pas disponible dans ce lien');
  await expect(shared.locator('.beach-result')).toHaveCount(2);await shared.close();
});

test('recherche: une nouvelle tentative conserve le perimetre de proximite',async({page})=>{
  await controlledGps(page);let calls=0;
  await page.route('**/api/recommendations*',route=>++calls===1?route.fulfill({status:503,json:{}}):route.fulfill({json:[a]}));
  await page.goto('/recherche');await page.getByRole('button',{name:'Autour de moi'}).click();await resolveGps(page);
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button',{name:/essayer/}).click();
  await expect(page.locator('.beach-result')).toHaveCount(1);expect(calls).toBe(2);
  await expect(page.getByRole('status')).toContainText('votre position');
});

test('detail: changement de plage sur la meme route sans reutilisation des conditions',async({page})=>{
  await page.goto('/plages/'+a.id);await expect(page.getByRole('heading',{name:a.name,exact:true})).toBeVisible();
  await page.evaluate(id=>{
    history.pushState({navigationId:998},'','/plages/'+id);
    dispatchEvent(new PopStateEvent('popstate',{state:history.state}));
  },b.id);
  await expect(page.getByRole('heading',{name:b.name,exact:true})).toBeVisible();
  await expect(page.locator('.conditions-grid strong').first()).toContainText('18');
  await page.goBack();await expect(page.getByRole('heading',{name:a.name,exact:true})).toBeVisible();
  await expect(page.locator('.conditions-grid strong').first()).toContainText('24');
});

test('recherche: nouvelle tentative communale sans remplacement par le catalogue national',async({page})=>{
  let calls=0;
  const commune={code:'83009',name:'Bandol',department:{code:'83',name:'Var'},region:{code:'93',name:'Provence'},
    center:{lat:43.14,lon:5.76},bbox:[43.1,5.7,43.2,5.8],
    contour:{type:'Polygon',coordinates:[[[5.7,43.1],[5.8,43.1],[5.8,43.2],[5.7,43.2],[5.7,43.1]]]}};
  await page.route('**/api/places/communes/83009/beaches',route=>++calls===1
    ?route.fulfill({status:503,json:{}})
    :route.fulfill({json:{commune,beaches:[a],coverage:'partial',imported:0,provider:'local-catalogue'}}));
  await page.goto('/recherche?commune=83009');await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button',{name:/essayer/}).click();
  await expect(page.locator('.beach-result')).toHaveCount(1);expect(calls).toBe(2);
  await expect(page.locator('.commune-selection')).toContainText('Bandol');
  await expect(page).toHaveURL(/commune=83009/);
});
