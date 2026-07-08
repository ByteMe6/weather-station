/** @type {import('jest').Config} */
const config = {
  projects: [
    {
      displayName: 'unit',
      testMatch: ['<rootDir>/tests/unit/**/*.test.ts'],
      transform: {
        '^.+\\.ts$': [
          'ts-jest',
          { tsconfig: { module: 'commonjs', verbatimModuleSyntax: false } },
        ],
      },
    },
  ],
}

export default config
