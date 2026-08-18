import path from 'node:path'

/**
 * Artefacts the suite writes between projects. Resolved against the working
 * directory rather than `__dirname`: this package is `"type": "module"`, so
 * `__dirname` does not exist, and every entry point (`yarn test:e2e`,
 * `yarn workspace @ws/web test:e2e`) runs with `apps/web` as the cwd.
 */
export const AUTH_FILE = path.resolve('playwright/.clerk/user.json')
export const FIXTURES_FILE = path.resolve('playwright/.clerk/fixtures.json')
