import type { Browser } from 'webextension-polyfill';

declare global {
  // Safari implements the promise-based `browser` namespace natively; we only borrow its type.
  // eslint-disable-next-line no-var
  var browser: Browser;
}

export {};
