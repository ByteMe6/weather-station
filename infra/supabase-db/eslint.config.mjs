import { baseConfig } from '@ws/eslint-config/base'

export default [
  // supabase/functions/** is Deno code — covered by `deno lint`/`deno check`
  // in CI, not ESLint.
  { ignores: ['dist/**', 'coverage/**', 'supabase/**'] },
  ...baseConfig,
]
