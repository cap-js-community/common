"use strict";

const cds = require("@sap/cds");

const { GET, test } = cds.test(__dirname + "/../..");

process.env.PORT = 0; // Random

cds.env.replicationCache.plugin = true;
cds.env.replicationCache.deploy = true;
cds.env.replicationCache.wait = false;
cds.env.replicationCache.credentials.database = ":memory:";

describe("No wait", () => {
  beforeEach(async () => {
    await test.data.reset();
    await cds.replicationCache.reset();
  });

  it("GET via db", async () => {
    await cds.tx(async (tx) => {
      const result = await tx.run(SELECT.from("test.Books", ["ID", "title"]));
      expect(result.length).toBe(100);
      expect(cds.replicationCache.stats.missed).toBe(1);
      expect(cds.replicationCache.stats.used).toBe(0);
      expect(cds.replicationCache.stats.counts["test.Books"]).toBe(1);
    });

    await cds.replicationCache.prepared(undefined, "test.Books");

    await cds.tx(async (tx) => {
      const result = await tx.run(SELECT.from("test.Books", ["ID", "title"]));
      expect(result.length).toBe(100);
      for (const row of result) {
        expect(row.ID).toEqual(expect.any(Number));
        expect(row.title).toEqual(expect.any(String));
      }
      expect(cds.replicationCache.stats.used).toBe(1);
      expect(cds.replicationCache.stats.counts["test.Books"]).toBe(2);
    });
  });

  it("Get via service", async () => {
    let response = await GET("/odata/v4/test/Books", {
      headers: {
        "Accept-Language": "en",
      },
    });
    expect(response.data.value.length).toBe(100);
    expect(cds.replicationCache.stats.missed).toBe(1);
    expect(cds.replicationCache.stats.used).toBe(0);
    expect(cds.replicationCache.stats.counts["test.Books"]).toBe(1);

    await cds.replicationCache.prepared(undefined, "test.Books");
    response = await GET("/odata/v4/test/Books", {
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
    expect(cds.replicationCache.stats.counts["test.Books"]).toBe(2);
  });
});
