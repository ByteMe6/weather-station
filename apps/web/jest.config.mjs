/** @type {import('jest').Config} */
const tsProject = (displayName, dir) => ({
  displayName,
  testMatch: [`<rootDir>/tests/${dir}/**/*.test.{ts,tsx}`],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      { tsconfig: { module: 'commonjs', verbatimModuleSyntax: false } },
    ],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^server-only$': '<rootDir>/tests/stubs/server-only.ts',
  },
})

const config = {
  projects: [
    tsProject('unit', 'unit'),
    tsProject('integration', 'integration'),
  ],
}

export default config
