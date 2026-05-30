import type { Browser } from 'webextension-polyfill';

declare global {
  // Safari implements the promise-based `browser` namespace natively; we only borrow its type.
  // `var` is required for global ambient declarations (let/const are not valid in declare global).
  var browser: Browser;
}

export {};
