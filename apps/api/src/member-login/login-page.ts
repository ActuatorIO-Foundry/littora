import type {Request} from 'express';

export const loginPage = (content: string) => '<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Compte | Littora</title><main><h1>Littora</h1>' + content + '</main></html>';

export const sameOriginPost = (req: Request, origin: string) =>
  req.headers.origin === origin && (!req.headers['sec-fetch-site'] || req.headers['sec-fetch-site'] === 'same-origin');
