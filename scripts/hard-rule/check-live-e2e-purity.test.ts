import { describe, it, expect } from 'vitest';
import { checkFile } from './check-live-e2e-purity.mjs';

const LIVE = 'packages/extension-chrome/e2e/x.live.spec.ts';

describe('check-live-e2e-purity', () => {
  it('flags a mock import inside a live spec', () => {
    const v = checkFile(LIVE, `import { mockGemini } from './helpers';`);
    expect(v).toHaveLength(1);
    expect(v[0].match).toBe('mockGemini');
  });

  it('flags context.route in a live spec', () => {
    expect(checkFile(LIVE, `await context.route('**', r => r.abort());`)).toHaveLength(1);
  });

  it('flags page.route in a live spec (same bypass, different receiver)', () => {
    const v = checkFile(
      LIVE,
      `await page.route('**/generativelanguage.googleapis.com/**', r => r.fulfill({ body: 'fake' }));`,
    );
    expect(v).toHaveLength(1);
    expect(v[0].match).toBe('page.route(');
  });

  it('flags routeFromHAR in a live spec regardless of receiver', () => {
    const v = checkFile(
      LIVE,
      `await context.routeFromHAR('./fixtures/fake-gemini.har', { url: '**/generativelanguage.googleapis.com/**' });`,
    );
    expect(v).toHaveLength(1);
    expect(v[0].match).toBe('routeFromHAR(');
  });

  it('allows non-mock helpers in a live spec', () => {
    expect(checkFile(LIVE, `import { seedSettings, selectWord } from './helpers';`)).toEqual([]);
  });

  it('ignores the same mock import in an ordinary spec', () => {
    const ordinary = 'packages/extension-chrome/e2e/x.spec.ts';
    expect(checkFile(ordinary, `import { mockGemini } from './helpers';`)).toEqual([]);
  });

  it('does not flag a mock name that only appears in a comment', () => {
    expect(checkFile(LIVE, `// never import mockGemini here\nconst a = 1;`)).toEqual([]);
  });
});
