import { baseConfig } from '@ws/eslint-config/base'
import { defineConfig } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

export default defineConfig([
  {
    // Config files sit outside tsconfig's include, so the type-aware rules
    // in baseConfig (projectService) cannot parse them.
    ignores: [
      'next.config.ts',
      'postcss.config.mjs',
      'jest.config.mjs',
      'eslint.config.mjs',
      // Playwright's generated output — a bundled report viewer and traces,
      // not our source. Gitignored, but eslint does not read .gitignore.
      'playwright-report/**',
      'test-results/**',
      'playwright/**',
    ],
  },
  ...nextVitals,
  ...nextTs,
  ...baseConfig,
])
