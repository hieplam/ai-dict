import { test as base, expect, chromium, type BrowserContext } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { E2E_HEADLESS } from '../playwright.config';
import { assertDeterministicBuild } from './build-guard';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');

/** Same launch args/headless/channel logic the default ephemeral fixture below uses, factored
 * out so the persistent-profile variant can call it against a real (not ephemeral) userDataDir
 * both for the initial launch and every subsequent relaunch. */
async function launchExtensionContext(userDataDir: string): Promise<BrowserContext> {
  await assertDeterministicBuild(dist);
  return chromium.launchPersistentContext(userDataDir, {
    channel: process.env.PLAYWRIGHT_CHROME_CHANNEL || undefined,
    headless: false,
    args: [
      ...(E2E_HEADLESS ? ['--headless=new'] : []),
      `--disable-extensions-except=${dist}`,
      `--load-extension=${dist}`,
    ],
  });
}

/** Read the extension id off a freshly-launched (or relaunched) context. NEVER cache this across
 * a relaunch — Chromium can assign a different extension id to the same unpacked extension on a
 * subsequent load, so every relaunch must re-derive it the same way this does. */
async function deriveExtensionId(context: BrowserContext): Promise<string> {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10_000 });
  return new URL(sw.url()).hostname;
}

/**
 * Chrome-extension fixture following Playwright's documented pattern.
 * `context` and `extensionId` are test-scoped (each test gets its own context).
 * chrome.storage.local is cleared once the context/extension id are ready, before the test body
 * runs, so cache/history/settings never leak between tests. This clearing lives inside the
 * `context` fixture's own setup (rather than a separate `test.beforeEach`) so it stays scoped to
 * exactly the tests that use this `test` export — a spec file that imports only the sibling
 * `persistentTest` variant below never picks it up, because it never uses this fixture at all.
 */
export const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  context: async ({}, use) => {
    await assertDeterministicBuild(dist);
    const context = await chromium.launchPersistentContext('', {
      // Optional real-Chrome channel for local runs; undefined = bundled Chromium.
      channel: process.env.PLAYWRIGHT_CHROME_CHANNEL || undefined,
      // Keep Playwright in "headed" mode and opt into Chromium's NEW headless via an arg when
      // E2E_HEADLESS is set (the default). Playwright's `headless:true` injects the OLD headless
      // mode, which cannot load MV3 extensions (the service worker never registers);
      // `--headless=new` can. Pass HEADED=1 to watch a real window. See playwright.config.ts.
      headless: false,
      args: [
        ...(E2E_HEADLESS ? ['--headless=new'] : []),
        `--disable-extensions-except=${dist}`,
        `--load-extension=${dist}`,
      ],
    });
    const extensionId = await deriveExtensionId(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.evaluate(() => chrome.storage.local.clear());
    await page.close();
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    await use(await deriveExtensionId(context));
  },
});

/**
 * Live handle onto a real (non-ephemeral) persistent-profile session: `context`/`extensionId`
 * reflect whichever launch is currently open, and `relaunch()` mutates both in place after
 * closing the old context and launching a fresh one against the SAME `userDataDir` — the only
 * way to observe what a real user (and a real MV3 service-worker cold start) sees across a
 * browser restart: `chrome.storage.local` persisted on disk, re-read by a brand-new SW process.
 */
export interface PersistentSession {
  context: BrowserContext;
  extensionId: string;
  relaunch: () => Promise<void>;
}

/**
 * Opt-in variant of `test` for specs that need a REAL (not Playwright-ephemeral) userDataDir so
 * the extension's persisted `chrome.storage.local` survives closing and relaunching the browser.
 * Deliberately separate from `test`: it does NOT run the per-test storage-clearing `beforeEach`
 * above (persistence across relaunch is the entire point of this variant), and every existing
 * spec keeps importing the untouched `test` export with no behavior change.
 */
export const persistentTest = base.extend<{ userDataDir: string; session: PersistentSession }>({
  userDataDir: async ({}, use) => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ai-dict-e2e-'));
    await use(dir);
    await rm(dir, { recursive: true, force: true });
  },
  session: async ({ userDataDir }, use) => {
    const context = await launchExtensionContext(userDataDir);
    const session: PersistentSession = {
      context,
      extensionId: await deriveExtensionId(context),
      relaunch: async () => {
        await session.context.close();
        session.context = await launchExtensionContext(userDataDir);
        session.extensionId = await deriveExtensionId(session.context);
      },
    };
    await use(session);
    await session.context.close();
  },
});

export { expect };
