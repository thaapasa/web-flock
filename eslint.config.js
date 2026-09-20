import js from '@eslint/js';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// No eslint-config-prettier here on purpose. ESLint dropped formatting rules
// from its recommended set in 8.53 and typescript-eslint's type-checked configs
// never had any, so there is nothing for it to turn off: measured against this
// config it disables 358 rules, none of which we enable. Re-check if a config
// that does carry formatting rules is ever added.
export default tseslint.config(
  { ignores: ['dist', 'site', 'node_modules', '.yarn'] },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: globals.browser,
    },
    plugins: { 'simple-import-sort': simpleImportSort },
    rules: {
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
