import { test as base } from '@playwright/test';

export { expect } from '@playwright/test';
export type { Page } from '@playwright/test';

export const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    const origin = new URL(baseURL!).origin;
    // Unhandled requests cannot reach a real backend or a public provider.
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === 'tile.openstreetmap.org' || url.hostname === 'services.data.shom.fr') {
        // Tiny local image double; CI never consumes public tile services.
        return route.fulfill({ contentType: 'image/png', body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64',
        ) });
      }
      if (url.origin !== origin) return route.abort();
      if (url.pathname.startsWith('/api/')) {
        return route.fulfill({ status: 503, json: { error: 'Unmocked test request' } });
      }
      return route.continue();
    });
    await use(page);
  },
});
