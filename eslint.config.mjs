// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importX from 'eslint-plugin-import-x';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/*.snapshot.json',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/e2e/**',
      'packages/*/playwright.config.ts',
      '.claude/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // allow root config TS files to type-check via an inferred default project
        projectService: {
          allowDefaultProject: ['*.config.ts', '*.config.mts', 'packages/*/vitest.config.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { 'import-x': importX },
    settings: {
      'import-x/resolver': { typescript: true },
    },
    rules: {
      // §8.3 structural zones (rule-domain-purity / ref-core-dependency-rule).
      // IDE-time feedback only — the hard allowlist gate is scripts/check-dep-direction.mjs,
      // which runs before every extension build and at the front of `bun run lint`.
      'import-x/no-restricted-paths': [
        'error',
        {
          zones: [
            // domain core MUST NOT import the edge (adapters/ui/wire/barrel) or a shell
            {
              target: './packages/app/src/domain',
              from: [
                './packages/app/src/app',
                './packages/app/src/ui',
                './packages/app/src/wire.ts',
                './packages/app/src/index.ts',
                './packages/extension-chrome',
                './packages/extension-safari',
              ],
            },
            // the core package MUST NOT import an extension shell
            {
              target: './packages/app/src',
              from: ['./packages/extension-chrome', './packages/extension-safari'],
            },
            // shells MUST NOT import each other
            {
              target: './packages/extension-chrome/src',
              from: ['./packages/extension-safari'],
            },
            {
              target: './packages/extension-safari/src',
              from: ['./packages/extension-chrome'],
            },
            // extension tests MUST NOT import sibling adapters (inject via fakes)
            {
              target: './packages/extension-chrome/test',
              from: ['./packages/extension-chrome/src/adapters'],
            },
            {
              target: './packages/extension-safari/test',
              from: ['./packages/extension-safari/src/adapters'],
            },
          ],
        },
      ],
    },
  },
  // JS config files (eslint.config.mjs etc.) have no type info — turn off type-checked rules
  { files: ['**/*.{js,mjs,cjs}'], extends: [tseslint.configs.disableTypeChecked] },
  // scripts/ TS files (tooling tests/configs) sit outside every tsconfig project,
  // so type-aware linting cannot resolve them — same treatment as JS configs.
  { files: ['scripts/**/*.ts'], extends: [tseslint.configs.disableTypeChecked] },
  // Node-runtime scripts: declare Node globals so process/console/URL etc. are defined.
  // Scoped to scripts/ (root + package) and esbuild configs — does NOT affect browser/extension source.
  {
    files: ['scripts/**/*.mjs', 'packages/*/scripts/**/*.mjs', '**/esbuild.config.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
      },
    },
  },
  prettier,
);
