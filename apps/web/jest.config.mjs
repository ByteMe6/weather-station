/** @type {import('jest').Config} */
const config = {
  projects: [
    {
      displayName: 'unit',
      testMatch: ['<rootDir>/tests/unit/**/*.test.{ts,tsx}'],
      transform: {
        '^.+\\.tsx?$': [
          'ts-jest',
          { tsconfig: { module: 'commonjs', verbatimModuleSyntax: false } },
        ],
      },
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
      },
    },
  ],
}

export default config
