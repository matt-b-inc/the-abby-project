import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'coverage']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // ``no-unused-vars`` can't see JSX member-expression usage like
      // ``<motion.div>`` or ``<Icon size={...}>``. Cover the common cases:
      //   - varsIgnorePattern ``^[A-Z_]`` keeps PascalCase imports/aliases
      //     (Icon, FormModal, etc.) from being flagged when only used in JSX.
      //   - argsIgnorePattern catches destructured renames inside callbacks
      //     like ``map(({ icon: Icon }) => <Icon />)``.
      //   - The explicit ``motion`` exemption handles framer-motion's
      //     lowercase JSX namespace (``<motion.div>``).
      'no-unused-vars': ['error', {
        varsIgnorePattern: '^[A-Z_]|^motion$',
        argsIgnorePattern: '^[A-Z_]|^_',
        destructuredArrayIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Build/config files run in Node, not the browser, so allow ``process``
    // and friends.
    files: ['vite.config.js', 'vitest.config.js', 'eslint.config.js', 'playwright.config.js', 'e2e/**/*.js'],
    languageOptions: { globals: globals.node },
  },
  {
    // Test files run under Vitest's globals: `vi`, `describe`, `it`,
    // `expect`, `beforeAll`, `beforeEach`, `afterAll`, `afterEach`. The
    // `test/` scaffolding imports them explicitly but still needs the same
    // relaxations as the test files themselves.
    files: ['src/**/*.test.{js,jsx}', 'src/test/**/*.{js,jsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        vi: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeAll: 'readonly',
        beforeEach: 'readonly',
        afterAll: 'readonly',
        afterEach: 'readonly',
      },
    },
  },
])
