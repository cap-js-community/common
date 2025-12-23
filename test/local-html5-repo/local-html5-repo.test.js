"use strict";

const cds = require("@sap/cds");

const { test } = cds.test(__dirname + "/../..");

const { LocalHTML5Repo } = require("../../src/local-html5-repo");

process.env.PORT = 0; // Random

describe("Local HTML5 Repo", () => {
  const log = cds.test.log();

  beforeEach(async () => {
    await test.data.reset();
  });

  it("Start", async () => {
    const port = Math.floor(Math.random() * 1000) + 53001;
    const localHTML5Repo = await new LocalHTML5Repo({ port });
    await localHTML5Repo.start();
    expect(log.output).toContain(`Rewriting HTML5 Repo URL in default-env.json of approuter: http://localhost:${port}`);
    expect(log.output).toContain("Registering apps:");
    expect(log.output).toMatch(/- test \[application] -> .*common\/app\/test/);
    expect(log.output).toContain(`Local HTML5 repository running on port ${port}`);
    await localHTML5Repo.stop();
  });
});
