"use strict";

module.exports = {
  reporters: ["default"],
  automock: false,
  bail: false,
  clearMocks: false,
  collectCoverage: true,
  collectCoverageFrom: ["cds-plugin.js", "**/src/**/*.js", "**/srv/**/*.js", "!**/bin/**/*.js", "!**/gen/**/*.js"],
  coverageDirectory: "reports/coverage/unit/",
  coverageReporters: ["lcov", "text"],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 85,
      lines: 85,
      statements: 85,
    },
  },
  moduleDirectories: ["node_modules"],
  modulePathIgnorePatterns: [],
  resetMocks: false,
  resetModules: false,
  testMatch: ["**/test/**/*.test.js"],
  testPathIgnorePatterns: ["/node_modules/", "/bin/", "/gen/"],
  verbose: true,
  maxWorkers: 2,
  setupFilesAfterEnv: [],
  testTimeout: 60000,
};
