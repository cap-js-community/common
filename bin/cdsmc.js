#!/usr/bin/env node
"use strict";

/* eslint-disable no-console */
/* eslint-disable n/no-process-exit */

const commander = require("commander");
const program = new commander.Command();

const packageJSON = require("../package.json");

const { MigrationCheck } = require("../src/migration-check");

process.argv = process.argv.map((arg) => {
  return arg.toLowerCase();
});

program
  .version(packageJSON.version, "-v, --version")
  .usage("[options]")
  .option("-u, --update", "Update prod CSN")
  .option("-a, --admin", "Admin mode");

program.unknownOption = function () {};
program.parse(process.argv);

(() => {
  try {
    const options = program.opts();
    const migrationCheck = new MigrationCheck(options);
    if (options.update) {
      const result = migrationCheck.update(options.admin);
      for (const message of result.messages) {
        console.log(message);
      }
      process.exit(result.success ? 0 : -1);
    } else {
      const result = migrationCheck.check(options.admin);
      for (const message of result.messages) {
        console.log(message);
      }
      if (result.adminHash) {
        console.log(`Admin hash: ${result.adminHash}`);
      }
      process.exit(result.success ? 0 : -1);
    }
  } catch (err) {
    console.error(err);
    process.exit(-1);
  }
})();
