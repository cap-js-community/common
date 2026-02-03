#!/usr/bin/env node
"use strict";

/* eslint-disable no-console */
/* eslint-disable n/no-process-exit */

const commander = require("commander");
const program = new commander.Command();

const packageJSON = require("../package.json");

const { CDMBuilder } = require("../src/cdm-build");

process.argv = process.argv.map((arg) => {
  return arg.toLowerCase();
});

program.version(packageJSON.version, "-v, --version").usage("[options]").option("-f, --force", "Force generation");

program.unknownOption = function () {};
program.parse(process.argv);

(async () => {
  try {
    const options = program.opts();
    await new CDMBuilder(options).build();
  } catch (err) {
    console.error(err);
    process.exit(-1);
  }
})();
