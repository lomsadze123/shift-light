// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier/flat');

// Imports that would tie code to one platform (React Native, Expo, or Node).
// Pure modules must run both in Node (tests, scripts) and in the app.
const platformImports = {
  group: [
    'react',
    'react/*',
    'react-native',
    'react-native/*',
    'react-native-*',
    'expo',
    'expo/*',
    'expo-*',
    '@expo/*',
    'net',
    'node:net',
    'fs',
    'fs/*',
    'node:fs',
    'node:fs/*',
  ],
  message: 'Pure module: no React, React Native, Expo, net or fs imports (see CLAUDE.md).',
};

// Dependency direction is ui → core ← transports, so core never imports either.
const coreOutwardImports = {
  group: ['**/ui', '**/ui/**', '**/transports', '**/transports/**'],
  message: 'src/core must not import from ui or transports (ui → core ← transports).',
};

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', '.expo/*', 'ios/*', 'android/*'],
  },
  {
    // Pure transports. Platform-specific ones (tcpNode, tcpNative, ble) are not listed.
    files: ['src/transports/simulatedCar.ts', 'src/transports/mock.ts', 'src/transports/tcp.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [platformImports] }],
    },
  },
  {
    files: ['src/core/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [platformImports, coreOutwardImports] }],
    },
  },
  // Must stay last: turns off every ESLint rule that conflicts with Prettier.
  prettierConfig,
]);
