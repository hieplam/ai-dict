import { test, expect } from './fixtures';
import { gotoFixture } from './helpers';

// Both components pin text color #202124 → computed rgb(32, 33, 36). The regression: the
// trigger button previously inherited the system color, which goes (near-)white under a dark
// theme and vanished on its white background. Asserting the explicit value under dark
// emulation fails if anyone removes the color pin.
const PINNED = 'rgb(32, 33, 36)';

async function waitForElements(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(
    () => !!customElements.get('lookup-trigger') && !!customElements.get('lookup-card'),
    null,
    { timeout: 10_000 },
  );
}

for (const scheme of ['light', 'dark'] as const) {
  test(`Define button label stays visible in ${scheme} theme`, async ({ context }) => {
    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: scheme });
    await gotoFixture(page);
    await waitForElements(page);

    const { label, color } = await page.evaluate(() => {
      const el = document.createElement('lookup-trigger');
      document.body.append(el);
      const btn = (el as HTMLElement).shadowRoot!.querySelector('button')!;
      return { label: btn.textContent, color: getComputedStyle(btn).color };
    });

    expect(label).toBe('Define');
    expect(color).toBe(PINNED);
    await page.close();
  });

  test(`result card text stays visible in ${scheme} theme`, async ({ context }) => {
    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: scheme });
    await gotoFixture(page);
    await waitForElements(page);

    const { text, color } = await page.evaluate(() => {
      const card = document.createElement('lookup-card');
      document.body.append(card);
      // Drive the card via its public state setter (same world as the page).
      (card as unknown as { state: unknown }).state = {
        kind: 'result',
        safeHtml: '<p>A financial institution.</p>',
        word: 'bank',
        target: 'vi',
      };
      return { text: (card as HTMLElement).textContent, color: getComputedStyle(card).color };
    });

    expect(text).toContain('financial institution');
    expect(color).toBe(PINNED);
    await page.close();
  });
}
