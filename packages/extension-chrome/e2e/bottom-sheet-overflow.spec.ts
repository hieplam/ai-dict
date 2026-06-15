import { test, expect } from './fixtures';
import { seedSettings, gotoFixture, selectWord, openTrigger, mockGemini } from './helpers';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Issue #52: the in-page bottom sheet "breaks when text too much" on short / mobile viewports.
// The panel is bottom-anchored and caps its height at the viewport (88dvh, 88vh fallback) and
// is the scroll container, so a long bilingual definition must stay fully on-screen and scroll
// INSIDE the sheet — it must never grow past the top of the viewport. This spec pins that
// invariant on a short viewport and doubles as the PR evidence capture (e2e-evidence/issue-52/).
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../e2e-evidence/issue-52');
const shot = (name: string) => path.join(out, `${name}.png`);

const LONG = `**IPA** /ˈdaɪvɪŋ/ (UK /ˈdaɪvɪŋ/)
**English definition** Starting to deal with or examine something in a thorough and detailed way; also the activity of swimming under water or jumping into water head-first.
**Vietnamese** Đi sâu vào, bắt đầu tìm hiểu kỹ lưỡng về một vấn đề hoặc chủ đề nào đó; hoặc hoạt động lặn, nhảy xuống nước.
**Register** Neutral
**Example** Before diving into the specific numbers, the team should review the overall goals of the project together. Trước khi đi sâu vào các con số cụ thể, cả nhóm nên cùng xem xét lại các mục tiêu tổng thể của dự án.`;

test('long content stays bounded and scrolls within the sheet on a short viewport', async ({
  context,
  extensionId,
}) => {
  await mockGemini(context, {
    body: JSON.stringify({ candidates: [{ content: { parts: [{ text: LONG }] } }] }),
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 412, height: 480 }); // short, phone-like
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page, {
    apiKey: 'AIza-test',
    hasKey: true,
    theme: 'sepia',
    cacheEnabled: false,
  });
  await gotoFixture(page, 'Before diving into the numbers we should align on goals.');
  await page.waitForTimeout(800);
  await selectWord(page, 't', 'diving');
  await openTrigger(page);
  const card = page.locator('bottom-sheet lookup-card');
  await card.waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForTimeout(400);

  const m = await page.evaluate(() => {
    const sheet = document.querySelector('bottom-sheet')!;
    const panel = sheet.shadowRoot!.querySelector('.panel') as HTMLElement;
    const r = panel.getBoundingClientRect();
    return {
      viewportH: window.innerHeight,
      panelTop: Math.round(r.top),
      panelBottom: Math.round(r.bottom),
      scrolls: panel.scrollHeight > panel.clientHeight + 1,
    };
  });

  // The panel never extends above the top of the viewport (the header/close button stay reachable)…
  expect(m.panelTop).toBeGreaterThanOrEqual(0);
  // …it is anchored to the bottom of the viewport…
  expect(m.panelBottom).toBe(m.viewportH);
  // …and the long definition scrolls inside it rather than overflowing the sheet.
  expect(m.scrolls).toBe(true);

  await page.screenshot({ path: shot('long-content-short-viewport') });
  const closeBtn = card.locator('button[aria-label="Close"]');
  await expect(closeBtn).toBeVisible(); // header controls remain on-screen at the top of the sheet
});
