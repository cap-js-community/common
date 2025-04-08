"use strict";

const cds = require("@sap/cds");

const { GET, test } = cds.test(__dirname + "/../..");

process.env.PORT = 0; // Random

cds.env.replicationCache.plugin = true;
cds.env.replicationCache.deploy = true;
cds.env.replicationCache.wait = true;
cds.env.replicationCache.deploy = false;
cds.env.replicationCache.credentials.database = ":memory:";

describe("No Deploy", () => {
  beforeEach(async () => {
    await test.data.reset();
    await cds.replicationCache.reset();
  });

  it("GET via db - entity", async () => {
    await cds.tx(async (tx) => {
      const result = await tx.run(SELECT.from("test.Books", ["ID", "title"]));
      expect(result.length).toBe(100);
      for (const row of result) {
        expect(row.ID).toEqual(expect.any(Number));
        expect(row.title).toEqual(expect.any(String));
      }
      expect(cds.replicationCache.stats.used).toBe(1);
      expect(cds.replicationCache.stats.counts["test.Books"]).toBe(1);
    });
  });

  it("GET via db - view", async () => {
    await cds.tx(async (tx) => {
      const result = await tx.run(SELECT.from("TestService.Books", ["ID", "title"]));
      expect(result.length).toBe(100);
      for (const row of result) {
        expect(row.ID).toEqual(expect.any(Number));
        expect(row.title).toEqual(expect.any(String));
      }
      expect(cds.replicationCache.stats.used).toBe(0);
      expect(cds.replicationCache.stats.projections["TestService.Books"]).toBe(1);
      expect(cds.replicationCache.stats.counts["test.Books"]).toBeUndefined();
    });
  });

  it("Get via service - localized", async () => {
    const response = await GET("/odata/v4/test/Books");
    expect(response.data.value.length).toBe(100);
    expect(cds.replicationCache.stats.used).toBe(0);
    expect(cds.replicationCache.stats.localized["TestService.Books"]).toBe(1);
    expect(cds.replicationCache.stats.counts["test.Books"]).toBeUndefined();
  });
});
