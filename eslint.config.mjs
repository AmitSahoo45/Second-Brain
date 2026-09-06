import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/**', 'dist/**', '.wrangler/**', '.superpowers/**', 'shared-memory-blueprint/**', 'docs/**', 'evidence/**', 'worker-configuration.d.ts'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  { rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
  { files: ['**/*.mts'], languageOptions: { globals: { console: 'readonly', process: 'readonly', Buffer: 'readonly', fetch: 'readonly', URL: 'readonly' } } },
);
