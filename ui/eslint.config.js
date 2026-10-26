// SPDX-License-Identifier: AGPL-3.0-or-later

import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['dist/', 'test-results/', 'playwright-report/'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    // Legacy JS imported from the reference renderer (Step 3a). It uses the
    // globals that src/legacy/globals.ts installs, and its idioms (`catch (_)`,
    // unused callback parameters, `a ? b() : c()`). New code is TypeScript.
    files: ['src/**/*.js'],
    languageOptions: {
      globals: {
        Store: 'readonly',
        qKind: 'readonly',
        CustomSelect: 'readonly',
        Chart: 'readonly',
        Handsontable: 'readonly',
      },
    },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-unused-expressions': ['error', { allowTernary: true }],
    },
  },
  prettier,
);
