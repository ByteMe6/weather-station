/** @type {import('jest').Config} */
const tsProject = (displayName, dir) => ({
  displayName,
  testMatch: [`<rootDir>/tests/${dir}/**/*.test.{ts,tsx}`],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          verbatimModuleSyntax: false,
          jsx: 'react-jsx',
        },
      },
    ],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^server-only$': '<rootDir>/tests/stubs/server-only.ts',
    '^motion/react$': '<rootDir>/tests/stubs/motion-react.tsx',
    '^next/navigation$': '<rootDir>/tests/stubs/next-navigation.ts',
    // jsdom has no layout engine, so Leaflet cannot render; stub both packages.
    '^react-leaflet$': '<rootDir>/tests/stubs/react-leaflet.tsx',
    '^leaflet$': '<rootDir>/tests/stubs/leaflet.ts',
    '\\.css$': '<rootDir>/tests/stubs/style.ts',
  },
  setupFilesAfterEnv: ['<rootDir>/tests/stubs/jest-dom-setup.ts'],
})

const config = {
  projects: [
    tsProject('unit', 'unit'),
    tsProject('integration', 'integration'),
  ],
}

export default config
