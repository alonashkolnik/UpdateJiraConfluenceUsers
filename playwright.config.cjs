// Electron end-to-end tests: the app is built once (global setup), then each
// spec launches the real app against a local mock Atlassian server (test/helpers).
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './test',
  testMatch: '**/*.spec.cjs',
  globalSetup: './test/global-setup.cjs',
  timeout: 60000,
  workers: 2,
  reporter: [['list']],
});
