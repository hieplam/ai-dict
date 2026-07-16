import { readFile } from 'node:fs/promises';
import path from 'node:path';

interface BuildMeta {
  geminiKeyFromEnv: boolean;
}

/**
 * C10: fail fast, with an actionable message, when the built dist/ was produced with
 * GEMINI_API_KEY set in the builder's shell. That build silently disables onboarding
 * (options.ts's KEY_FROM_ENV routing) and makes the onboarding e2e specs fail in a way that
 * looks unrelated to its real cause. Reads only the boolean marker esbuild.config.mjs writes —
 * never the key itself (S1: rule-api-key-isolation).
 */
export async function assertDeterministicBuild(distDir: string): Promise<void> {
  const metaPath = path.join(distDir, 'build-meta.json');
  let meta: BuildMeta;
  try {
    meta = JSON.parse(await readFile(metaPath, 'utf8')) as BuildMeta;
  } catch {
    throw new Error(
      `e2e: ${metaPath} is missing. Build with \`bun run build:chrome:e2e\` (from the repo root) ` +
        'before running the e2e suite.',
    );
  }
  if (meta.geminiKeyFromEnv) {
    throw new Error(
      'e2e: dist/ was built with GEMINI_API_KEY set, which disables onboarding and makes ' +
        'onboarding.spec.ts fail. Rebuild with `bun run build:chrome:e2e` (from the repo root) — ' +
        'it clears the var for you — or `unset GEMINI_API_KEY` and rebuild with `bun run build:chrome`.',
    );
  }
}
