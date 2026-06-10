import { test, expect } from './fixtures';
import { gotoFixture } from './helpers';

// Regression guard, updated for the adaptive cozy palette. The trigger button and the result
// card pin an EXPLICIT text colour from the --ad-ink token — never the system `canvastext`,
// which goes near-white under a dark theme and used to vanish the "Define" label on its
// surface. The token is theme-aware: a dark warm ink on the light surface, a light warm ink
// on the dark surface. Since the theme setting landed, OS-following requires theme="system"
// (no attribute = light), so the elements are stamped with it here to exercise both palettes.
// We assert the text is legible *against its own theme* (dark-on-light / light-on-dark)
// rather than against one fixed value. Colours are normalised through a <canvas> so the
// check does not depend on how the browser serialises oklch().

async function waitForElements(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(
    () => !!customElements.get('lookup-trigger') && !!customElements.get('lookup-card'),
    null,
    { timeout: 10_000 },
  );
}

for (const scheme of ['light', 'dark'] as const) {
  // dark ink on a light page → low luminance; light ink on a dark page → high luminance.
  const isLegible = (lum: number): boolean => (scheme === 'light' ? lum < 0.4 : lum > 0.6);

  test(`Define button label stays visible in ${scheme} theme`, async ({ context }) => {
    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: scheme });
    await gotoFixture(page);
    await waitForElements(page);

    const { label, lum } = await page.evaluate(() => {
      const el = document.createElement('lookup-trigger');
      el.setAttribute('theme', 'system'); // follow the emulated OS scheme
      document.body.append(el);
      const btn = (el as HTMLElement).shadowRoot!.querySelector('button')!;
      const ctx = document.createElement('canvas').getContext('2d')!;
      ctx.fillStyle = getComputedStyle(btn).color; // normalise rgb()/oklch() → canvas pixel
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return { label: btn.textContent, lum: (0.2126 * r! + 0.7152 * g! + 0.0722 * b!) / 255 };
    });

    expect(label).toBe('Define');
    expect(isLegible(lum)).toBe(true);
    await page.close();
  });

  test(`result card text stays visible in ${scheme} theme`, async ({ context }) => {
    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: scheme });
    await gotoFixture(page);
    await waitForElements(page);

    const { text, lum } = await page.evaluate(() => {
      const card = document.createElement('lookup-card');
      card.setAttribute('theme', 'system'); // follow the emulated OS scheme
      document.body.append(card);
      // Drive the card via its public state setter (same world as the page).
      (card as unknown as { state: unknown }).state = {
        kind: 'result',
        safeHtml: '<p>A financial institution.</p>',
        word: 'bank',
        target: 'vi',
      };
      const ctx = document.createElement('canvas').getContext('2d')!;
      ctx.fillStyle = getComputedStyle(card).color;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return {
        text: (card as HTMLElement).textContent,
        lum: (0.2126 * r! + 0.7152 * g! + 0.0722 * b!) / 255,
      };
    });

    expect(text).toContain('financial institution');
    expect(isLegible(lum)).toBe(true);
    await page.close();
  });
}
