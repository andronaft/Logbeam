import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: { globals: { ...globals.browser, chrome: 'readonly' } },
  },
  {
    files: ['scripts/**/*.mjs', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['scripts/e2e.mjs'],
    // page.evaluate() callbacks run in the browser
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },
);
