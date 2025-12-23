#!/usr/bin/env node
"use strict";

/* eslint-disable no-console */
/* eslint-disable n/no-process-exit */

const commander = require("commander");
const program = new commander.Command();

const packageJSON = require("../package.json");

const { LocalHTML5Repo } = require("../src/local-html5-repo");

process.argv = process.argv.map((arg) => {
  return arg.toLowerCase();
});

program
  .version(packageJSON.version, "-v, --version")
  .usage("[options]")
  .option("-p, --port", "Port of local HTML5 repo");

program.unknownOption = function () {};
program.parse(process.argv);

(async () => {
  try {
    const options = program.opts();
    await new LocalHTML5Repo(options).start();
  } catch (err) {
    console.error(err);
    process.exit(-1);
  }
})();
