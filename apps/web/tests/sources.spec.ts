import {test, expect} from './fixtures';

test('crédits : accès depuis le pied de page et distinctions entre les sources', {tag:'@beta'}, async ({page}) => {
  await page.goto('/contact');
  await page.getByRole('contentinfo').getByRole('link',{name:'Données et sources'}).click();
  await expect(page).toHaveURL(/\/sources$/);
  const article=page.getByRole('article');
  await expect(article.getByRole('heading',{level:1})).toHaveText('Données et sources');
  await expect(article.getByRole('link',{name:'Open-Meteo',exact:true})).toHaveAttribute('href','https://open-meteo.com/');
  await expect(article.getByRole('link',{name:'CC BY 4.0'})).toHaveAttribute('href',/creativecommons\.org/);
  await expect(article.getByRole('link',{name:/contributeurs OpenStreetMap/})).toHaveAttribute('href',/openstreetmap\.org\/copyright/);
  await expect(article).toContainText('Un signalement communautaire n’est jamais un drapeau officiel');
  await expect(article).toContainText('La consultation ne nécessite pas de compte');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await article.getByRole('link',{name:'indices de confort'}).click();
  await expect(page).toHaveURL(/\/bareme$/);
});
