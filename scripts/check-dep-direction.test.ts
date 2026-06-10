import { describe, expect, it } from 'vitest';

import { extractImports, checkFile, checkRepo } from './check-dep-direction.mjs';

describe('extractImports', () => {
  it('extracts static, type-only, side-effect, export-from, and dynamic imports', () => {
    const src = [
      `import { mapError } from './error-mapper';`,
      `import type { LookupClient } from '../ports';`,
      `import 'reflect-metadata';`,
      `export { z } from 'zod';`,
      `export * from './types';`,
      `const m = await import('marked');`,
    ].join('\n');
    const specs = extractImports(src).map((i) => i.specifier);
    expect(specs).toEqual([
      './error-mapper',
      '../ports',
      'reflect-metadata',
      'zod',
      './types',
      'marked',
    ]);
  });

  it('handles multi-line import statements and reports 1-based line numbers', () => {
    const src = `const x = 1;\nimport {\n  a,\n  b,\n} from '../ports';\n`;
    const imports = extractImports(src);
    expect(imports).toEqual([{ specifier: '../ports', line: 2 }]);
  });

  it('returns an empty list for source without imports', () => {
    expect(extractImports('const a = 1;\n')).toEqual([]);
  });
});

describe('checkFile — rule-domain-purity (domain imports only ./ and ../ports)', () => {
  const domainFile = 'packages/app/src/domain/workflow.ts';

  it('accepts sibling domain imports and ../ports', () => {
    const src = `import type { LookupClient } from '../ports';\nimport { mapError } from './error-mapper';\n`;
    expect(checkFile(domainFile, src)).toEqual([]);
  });

  it.each([
    ['zod', 'npm library'],
    ['../app/router', 'shared adapter'],
    ['../ui/index', 'ui component'],
    ['../wire', 'wire edge'],
    ['../index', 'package barrel'],
    ['@ai-dict/extension-chrome', 'extension shell'],
  ])('rejects %s (%s)', (specifier) => {
    const violations = checkFile(domainFile, `import x from '${specifier}';\n`);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      file: domainFile,
      specifier,
      rule: 'rule-domain-purity',
    });
    expect(violations[0].hint).toContain('ports.ts');
  });
});

describe('checkFile — ports boundary (ports.ts imports domain types only)', () => {
  const portsFile = 'packages/app/src/ports.ts';

  it('accepts domain type imports', () => {
    expect(checkFile(portsFile, `import type { Entry } from './domain/types';\n`)).toEqual([]);
  });

  it.each(['zod', './app/router', './ui/index', './wire'])('rejects %s', (specifier) => {
    const violations = checkFile(portsFile, `import x from '${specifier}';\n`);
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('rule-ports-boundary');
  });
});

describe('checkFile — wire edge (wire.ts imports domain + zod only)', () => {
  const wireFile = 'packages/app/src/wire.ts';

  it('accepts zod and domain imports', () => {
    const src = `import { z } from 'zod';\nimport type { Entry } from './domain/types';\n`;
    expect(checkFile(wireFile, src)).toEqual([]);
  });

  it.each(['marked', './app/router', './ui/index'])('rejects %s', (specifier) => {
    const violations = checkFile(wireFile, `import x from '${specifier}';\n`);
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('rule-wire-edge');
  });
});

describe('checkFile — core never imports a shell (ref-core-dependency-rule)', () => {
  it.each([
    ['packages/app/src/app/router.ts', '@ai-dict/extension-chrome'],
    ['packages/app/src/ui/lookup-card.ts', '@ai-dict/extension-safari'],
    ['packages/app/src/index.ts', '../../extension-chrome/src/sw'],
  ])('%s may not import %s', (file, specifier) => {
    const violations = checkFile(file, `import x from '${specifier}';\n`);
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('rule-core-no-shell');
  });

  it('allows shared adapters to use npm libraries and the ui layer', () => {
    const src = `import DOMPurify from 'dompurify';\nimport { marked } from 'marked';\nimport { LookupCard } from '../ui/index';\n`;
    expect(checkFile('packages/app/src/app/markdown-sanitize.ts', src)).toEqual([]);
  });
});

describe('checkFile — shells never import each other', () => {
  it.each([
    ['packages/extension-chrome/src/sw.ts', '@ai-dict/extension-safari'],
    ['packages/extension-chrome/src/content.ts', '../../extension-safari/src/sw'],
    ['packages/extension-safari/src/sw.ts', '@ai-dict/extension-chrome'],
  ])('%s may not import %s', (file, specifier) => {
    const violations = checkFile(file, `import x from '${specifier}';\n`);
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('rule-shell-isolation');
  });

  it('allows shells to import the core and platform libraries', () => {
    const src = `import { runLookupWorkflow } from '@ai-dict/app';\nimport browser from 'webextension-polyfill';\nimport { ChromeKvStore } from './adapters/chrome-kv-store';\n`;
    expect(checkFile('packages/extension-chrome/src/content.ts', src)).toEqual([]);
  });
});

describe('checkRepo — integration on this repository', () => {
  it('finds zero violations on the current clean tree', () => {
    const violations = checkRepo(new URL('..', import.meta.url).pathname);
    expect(violations).toEqual([]);
  });
});
