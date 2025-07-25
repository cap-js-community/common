"use strict";

const fs = require("fs");
const path = require("path");
const cds = require("@sap/cds");
const os = require("os");

const { GET, test } = cds.test(__dirname + "/../..");

process.env.PORT = 0; // Random

const tmpDir = os.tmpdir();
const folder = "temp/db/default";

if (fs.existsSync(path.join(tmpDir, folder))) {
  fs.rmdirSync(path.join(tmpDir, folder), { force: true, recursive: true });
}

cds.env.replicationCache.plugin = true;
cds.env.replicationCache.deploy = true;
cds.env.replicationCache.wait = true;
cds.env.replicationCache.tmpDir = true;
cds.env.replicationCache.credentials.database = "data.sqlite";

describe("Temp", () => {
  beforeEach(async () => {
    await test.data.reset();
    await cds.replicationCache.reset();
  });

  it("GET via db", async () => {
    await cds.tx(async (tx) => {
      const result = await tx.run(SELECT.from("test.Books", ["ID", "title"]));
      expect(result.length).toBe(100);
      for (const row of result) {
        expect(row.ID).toEqual(expect.any(Number));
        expect(row.title).toEqual(expect.any(String));
      }
      expect(cds.replicationCache.stats.used).toBe(1);
      expect(cds.replicationCache.stats.counts["test.Books"]).toBe(1);
      expect(fs.existsSync(path.join(tmpDir, folder, "data.sqlite"))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, folder, "data-template.sqlite"))).toBe(true);
    });
  });

  it("Get via service", async () => {
    const response = await GET("/odata/v4/test/Books", {
      headers: {
        "Accept-Language": "en",
      },
    });
    expect(response.data.value.length).toBe(100);
    for (const row of response.data.value) {
      expect(row.ID).toEqual(expect.any(Number));
      expect(row.title).toEqual(expect.any(String));
    }
    expect(cds.replicationCache.stats.used).toBe(1);
    expect(cds.replicationCache.stats.counts["test.Books"]).toBe(1);
    expect(fs.existsSync(path.join(tmpDir, "temp/db/default/data.sqlite"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "temp/db/default/data-template.sqlite"))).toBe(true);
  });
});
