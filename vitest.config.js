"use strict";

const { defineConfig } = require("vitest/config");

module.exports = defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["**/test/**/*.test.js"],
    exclude: ["**/node_modules/**", "**/bin/**", "**/gen/**"],
    testTimeout: 60000,
    reporters: ["default"],
    pool: "forks",
    maxWorkers: 1,
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["lcov", "text"],
      reportsDirectory: "reports/coverage/unit/",
      include: ["cds-plugin.js", "**/src/**/*.js", "**/srv/**/*.js"],
      exclude: ["**/bin/**/*.js", "**/gen/**/*.js"],
      thresholds: {
        branches: 70,
        functions: 85,
        lines: 85,
        statements: 85,
      },
    },
  },
});
