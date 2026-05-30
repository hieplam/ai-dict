// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importX from 'eslint-plugin-import-x';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/*.snapshot.json'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // allow root config TS files to type-check via an inferred default project
        projectService: { allowDefaultProject: ['*.config.ts', '*.config.mts'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { 'import-x': importX },
    settings: {
      'import-x/resolver': { typescript: true },
    },
    rules: {
      // §8.3 structural zones (path-based)
      'import-x/no-restricted-paths': [
        'error',
        {
          zones: [
            // core MUST NOT import from adapters/ui/extensions
            {
              target: './packages/core/src',
              from: [
                './packages/adapters-shared',
                './packages/shared-ui',
                './packages/extension-chrome',
                './packages/extension-safari',
              ],
            },
            // adapters-shared MUST NOT import from extensions
            {
              target: './packages/adapters-shared/src',
              from: ['./packages/extension-chrome', './packages/extension-safari'],
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
  // §8.3 rule 3: shared-ui may import core TYPES ONLY (value imports forbidden)
  {
    files: ['packages/shared-ui/src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@ai-dict/core', '@ai-dict/core/*'],
              allowTypeImports: true,
              message: 'shared-ui may import core types only (import type ...).',
            },
          ],
        },
      ],
    },
  },
  // JS config files (eslint.config.mjs etc.) have no type info — turn off type-checked rules
  { files: ['**/*.{js,mjs,cjs}'], extends: [tseslint.configs.disableTypeChecked] },
  prettier,
);
