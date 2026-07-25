import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { test, expect } from './fixtures';
import { seedSettings } from './helpers';

// Read the real, current extension version from source — never hardcode it, so a future
// release-bump can't silently desync this assertion from packages/extension-chrome/src/manifest.json.
const manifestPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/manifest.json',
);
const EXTENSION_VERSION = (JSON.parse(readFileSync(manifestPath, 'utf8')) as { version: string })
  .version;

const LANDING_URL = 'https://hieplam.github.io/ai-dict/';

// Byte-for-byte the same script docs/index.html ships (design spec §3.3(d) / plan Task 3 Step 4).
const INSTALL_STATE_SCRIPT = `
  (function () {
    var COPY = {
      en: {
        ctaInstalled: 'Open setup',
        ctaReady: 'You’re all set ✓',
        statusInstalled: 'Install ✓ — next: add your key.',
        statusReady: 'All set ✓ — you’re ready to read.',
      },
      vi: {
        ctaInstalled: 'Mở phần thiết lập',
        ctaReady: 'Đã kích hoạt ✓',
        statusInstalled:
          'Đã cài ✓ — tiếp theo: thêm khoá của bạn.',
        statusReady: 'Đã xong ✓ — bạn đã sẵn sàng đọc.',
      },
    };

    function applyInstallState() {
      var root = document.documentElement;
      var installed = root.getAttribute('data-ad-dict-installed') === 'true';
      if (!installed) return;
      var ready = root.getAttribute('data-ad-dict-ready') === 'true';
      var lang = root.lang === 'vi' ? 'vi' : 'en';
      var t = COPY[lang];

      var cta = document.getElementById('hero-cta');
      if (cta) {
        cta.removeAttribute('data-i18n');
        if (ready) {
          cta.textContent = t.ctaReady;
          cta.removeAttribute('href');
          cta.setAttribute('aria-disabled', 'true');
          cta.setAttribute('tabindex', '-1');
        } else {
          cta.textContent = t.ctaInstalled;
          cta.setAttribute('href', '#start');
          cta.removeAttribute('aria-disabled');
          cta.removeAttribute('tabindex');
        }
      }

      var status = document.getElementById('start-status');
      if (status) {
        status.textContent = ready ? t.statusReady : t.statusInstalled;
        status.hidden = false;
      }
    }

    applyInstallState();
    new MutationObserver(applyInstallState).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-ad-dict-installed', 'data-ad-dict-ready', 'lang'],
    });
  })();
`;

// Minimal local stand-in for docs/index.html's #start/hero markup — mirrors the real structure
// (design spec §3.3(a)/(b)) plus a bare-bones stand-in for the real language-toggle click handler
// (docs/index.html:1856-1859) so the "lang" MutationObserver filter has something to react to.
const FIXTURE_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /></head>
  <body>
    <div class="lang-switch">
      <button type="button" data-lang="en">EN</button>
      <button type="button" data-lang="vi">VI</button>
    </div>
    <div class="cta-row">
      <a
        class="btn btn-primary"
        id="hero-cta"
        href="https://chromewebstore.google.com/detail/ai-dictionary/ipnmjhndmlkbhnifhmbknjjomdocgkeg"
        data-i18n="hero-cta-primary"
        >Add to Chrome, it&rsquo;s free</a
      >
    </div>
    <section id="start">
      <h2 data-i18n="start-h2">Get started</h2>
      <p class="start-status" id="start-status" hidden></p>
    </section>
    <script>
      document.querySelectorAll('.lang-switch [data-lang]').forEach(function (b) {
        b.addEventListener('click', function () {
          document.documentElement.lang = b.getAttribute('data-lang');
        });
      });
    </script>
    <script>${INSTALL_STATE_SCRIPT}</script>
  </body>
</html>`;

async function gotoRoutedLanding(page: import('@playwright/test').Page): Promise<void> {
  await page.route(`${LANDING_URL}**`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: FIXTURE_HTML }),
  );
  await page.goto(LANDING_URL);
  // The content script gates on isLandingPage(location) and runs at document_idle — wait for its
  // marker rather than a fixed timeout.
  await page.locator('html[data-ad-dict-installed="true"]').waitFor({ timeout: 10_000 });
}

test.describe('C11 install-aware landing page', () => {
  test('installed, no key: hero CTA + checklist status show "next: add your key"', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { apiKey: '', hasKey: false });

    await gotoRoutedLanding(page);

    await expect(page.locator('html')).toHaveAttribute('data-ad-dict-version', EXTENSION_VERSION);
    await expect(page.locator('html')).toHaveAttribute('data-ad-dict-ready', 'false');

    const cta = page.locator('#hero-cta');
    await expect(cta).toHaveText('Open setup');
    expect(await cta.getAttribute('href')).toBe('#start');
    expect(await cta.getAttribute('aria-disabled')).toBeNull();

    const status = page.locator('#start-status');
    await expect(status).toBeVisible();
    await expect(status).toHaveText('Install ✓ — next: add your key.');
  });

  test('installed and ready: hero CTA + checklist status show "all set"', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { apiKey: 'AIza-test', hasKey: true });

    await gotoRoutedLanding(page);

    await expect(page.locator('html')).toHaveAttribute('data-ad-dict-ready', 'true');

    const cta = page.locator('#hero-cta');
    await expect(cta).toHaveText('You’re all set ✓');
    expect(await cta.getAttribute('href')).toBeNull();
    expect(await cta.getAttribute('aria-disabled')).toBe('true');

    const status = page.locator('#start-status');
    await expect(status).toHaveText('All set ✓ — you’re ready to read.');
  });

  test('switching language re-syncs the adapted CTA and status copy', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { apiKey: '', hasKey: false });

    await gotoRoutedLanding(page);
    await expect(page.locator('#hero-cta')).toHaveText('Open setup');

    await page.locator('.lang-switch [data-lang="vi"]').click();

    await expect(page.locator('#hero-cta')).toHaveText('Mở phần thiết lập');
    await expect(page.locator('#start-status')).toHaveText(
      'Đã cài ✓ — tiếp theo: thêm khoá của bạn.',
    );
  });

  test('no marker (non-landing origin): the status pill stays truly hidden', async ({
    context,
  }) => {
    // Same fixture markup, but served from a non-landing origin so content.ts's isLandingPage()
    // gate is false and never stamps the marker — the exact "no extension marker" render the
    // page must degrade to. Guards the .start-status:not([hidden]) fix: a visible empty pill here
    // would mean author CSS is overriding the [hidden] UA rule again (design spec §2.5).
    const NON_LANDING_URL = 'https://example.com/';
    const page = await context.newPage();
    await page.route(`${NON_LANDING_URL}**`, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: FIXTURE_HTML }),
    );
    await page.goto(NON_LANDING_URL);

    // No marker is ever stamped here; the pill must remain hidden (display:none via the UA
    // [hidden] rule, no longer overridden by .start-status).
    await expect(page.locator('#start-status')).toBeHidden();
    // And the hero CTA keeps its authored install pitch (adaptation script early-returns).
    await expect(page.locator('#hero-cta')).toHaveText('Add to Chrome, it’s free');
  });
});
