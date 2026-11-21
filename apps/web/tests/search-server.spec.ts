import {expect,test} from './fixtures';
import {searchResult} from './search-response';

const beach={id:'server-601',name:'Plage distante',city:'Test',department:'Var',region:'Provence',lat:43.1,lon:6.2,
  waterType:'sea',has_parking:true,has_toilets:true,has_lifeguard:null,waterTemp:21,flag:'green',
  facilities:{rescueStation:{value:true}},scores:{bathing:50,family:85,paddle:20,boat:30},selectedScore:85};

test('filtre chiens : critère serveur, compteur, lien partageable et réinitialisation', async ({page})=>{
  const rows=['allowed','conditional','prohibited','unknown'].map((status,i)=>({...beach,
    id:'test-'+i,name:'Plage '+i,dogAccess:{status}}));
  const calls:any[]=[];
  await page.route('**/api/search/beaches',r=>{
    const body=r.request().postDataJSON(); calls.push(body);
    return r.fulfill({json:searchResult(body,rows)});
  });
  await page.goto('/recherche');
  const toggle=page.getByRole('button',{name:/Filtres/}), choice=page.getByLabel('Accès avec un chien');
  await toggle.click();
  await choice.selectOption('welcome');
  await expect(page.locator('.results-heading h2')).toContainText('2 plages');
  await expect(page.locator('.beach-result .dog-label')).toHaveText(['Chiens admis','Chiens admis sous conditions']);
  expect(calls.at(-1).dogAccess).toBe('welcome');
  await expect(toggle).toContainText('1');
  await choice.selectOption('allowed');
  await expect(page.locator('.beach-result')).toHaveCount(1);
  await expect(page).toHaveURL(/dogs=allowed/);
  await expect(page.getByRole('link',{name:'Détails'})).toHaveAttribute('href',/dogs=allowed/);
  await page.reload();
  await expect(page.locator('.beach-name')).toContainText('Plage 0');
  expect(calls.at(-1).dogAccess).toBe('allowed');
  await toggle.click();
  await expect(choice).toHaveValue('allowed');
  await page.getByRole('button',{name:'Réinitialiser'}).click();
  await expect(page.locator('.beach-result')).toHaveCount(4);
  await expect(page).not.toHaveURL(/dogs=/);
  expect(calls.at(-1).dogAccess).toBeUndefined();
});

test('recherche serveur: criteres combines, usage, total et carte partagent la meme reponse',async({page})=>{
  const requests:any[]=[];
  await page.route('**/api/search/beaches',route=>{
    const input=route.request().postDataJSON();requests.push(input);
    return route.fulfill({json:searchResult(input,[beach])});
  });
  await page.goto('/recherche?zone=azur&water=sea&parking=1&toilets=1&rescue=1&flag=green&min=20&max=22&usage=family&sort=score');
  await expect(page.locator('.results-heading h2')).toContainText('1 plage');
  await expect(page.locator('.beach-name')).toContainText(beach.name);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({waterType:'sea',parking:true,toilets:true,rescueStation:true,
    flag:'green',minWaterTemp:20,maxWaterTemp:22,usage:'family',sort:'score',limit:200});
  expect(requests[0].bbox).toBeTruthy();expect(requests[0].lat).toBeUndefined();
  await expect(page.getByRole('status')).toContainText('non officiels');
  if((page.viewportSize()?.width??1440)<761)await page.getByRole('button',{name:'Carte',exact:true}).click();
  await page.getByRole('button',{name:'Plage : '+beach.name,exact:true}).click();
  await expect(page.locator('.beach-result.selected')).toContainText(beach.name);
});

test('recherche serveur: minimum invalide, plage inconnue et reset sans ancien resultat',async({page})=>{
  const requests:any[]=[];
  await page.route('**/api/search/beaches',route=>{
    const input=route.request().postDataJSON();requests.push(input);
    return route.fulfill({json:searchResult(input,[{...beach,waterTemp:null}])});
  });
  await page.goto('/recherche?min=25&max=20');
  await expect(page.getByRole('alert')).toContainText('température minimale');expect(requests).toHaveLength(0);
  await page.getByRole('button',{name:/Filtres/}).click();
  await page.getByLabel('Max. °C').fill('30');
  await expect(page.locator('.results-heading h2')).toContainText('0 plage');
  await expect(page.getByRole('status')).toContainText('Valeurs inconnues exclues');
  await page.getByRole('button',{name:/initialiser/}).click();
  await expect(page.locator('.results-heading h2')).toContainText('1 plage');
  expect(requests.at(-1).minWaterTemp).toBeUndefined();expect(requests.at(-1).maxWaterTemp).toBeUndefined();
});

test('recherche serveur: pagination expiree ou incoherente ne montre jamais une liste partielle',async({page})=>{
  let expired=true;
  await page.route('**/api/search/beaches',route=>{
    const input=route.request().postDataJSON();
    if(input.cursor)return route.fulfill({status:409,json:{code:'CONFLICT'}});
    const result=searchResult({},[beach]);
    return route.fulfill({json:expired?{...result,total:2,pageInfo:{nextCursor:'next',limit:200,hasNextPage:true}}:result});
  });
  await page.goto('/recherche');await expect(page.getByRole('alert')).toContainText('expiré');
  await expect(page.locator('.beach-result')).toHaveCount(0);expired=false;
  await page.getByRole('button',{name:/essayer/}).click();await expect(page.locator('.beach-result')).toHaveCount(1);
  await page.route('**/api/search/beaches',route=>route.fulfill({json:{...searchResult({},[beach]),total:2}}));
  await page.reload();await expect(page.getByRole('alert')).toBeVisible();await expect(page.locator('.beach-result')).toHaveCount(0);
});
