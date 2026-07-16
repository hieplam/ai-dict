import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertDeterministicBuild } from '../e2e/build-guard';

describe('assertDeterministicBuild (C10)', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  async function tempDist(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'c10-build-guard-'));
    dirs.push(dir);
    return dir;
  }

  it('resolves silently when geminiKeyFromEnv is false', async () => {
    const dir = await tempDist();
    await writeFile(path.join(dir, 'build-meta.json'), JSON.stringify({ geminiKeyFromEnv: false }));
    await expect(assertDeterministicBuild(dir)).resolves.toBeUndefined();
  });

  it('throws an actionable error when geminiKeyFromEnv is true, without leaking any key value', async () => {
    const dir = await tempDist();
    await writeFile(path.join(dir, 'build-meta.json'), JSON.stringify({ geminiKeyFromEnv: true }));
    await expect(assertDeterministicBuild(dir)).rejects.toThrow(/GEMINI_API_KEY/);
    await expect(assertDeterministicBuild(dir)).rejects.toThrow(/build:chrome:e2e/);
  });

  it('throws a distinct "missing" error when build-meta.json does not exist', async () => {
    const dir = await tempDist();
    await expect(assertDeterministicBuild(dir)).rejects.toThrow(/is missing/);
  });
});
