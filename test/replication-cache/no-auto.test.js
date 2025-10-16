"use strict";

const cds = require("@sap/cds");

const { GET, test } = cds.test(__dirname + "/../..");

process.env.PORT = 0; // Random

cds.env.replicationCache.plugin = true;
cds.env.replicationCache.deploy = true;
cds.env.replicationCache.wait = true;
cds.env.replicationCache.auto = false;
cds.env.replicationCache.credentials.database = ":memory:";

describe("No Auto", () => {
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
      expect(cds.replicationCache.stats.missed).toBe(1);
      expect(cds.replicationCache.stats.used).toBe(0);
      expect(cds.replicationCache.stats.counts["test.Books"]).toBe(1);

      const tenant = await cds.replicationCache.entries.get(undefined);
      expect(tenant.entries.get("test.Books").status).toBe("NEW");
    });

    await cds.replicationCache.preload(undefined, ["test.Books"]);

    await cds.tx(async (tx) => {
      const tenant = await cds.replicationCache.entries.get(undefined);
      expect(tenant.entries.get("test.Books").status).toBe("READY");

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
    for (const row of response.data.value) {
      expect(row.ID).toEqual(expect.any(Number));
      expect(row.title).toEqual(expect.any(String));
    }
    expect(cds.replicationCache.stats.missed).toBe(1);
    expect(cds.replicationCache.stats.used).toBe(0);
    expect(cds.replicationCache.stats.counts["test.Books"]).toBe(1);
    expect(cds.replicationCache.stats.counts["test.Books.texts"]).toBe(1);

    let tenant = await cds.replicationCache.entries.get(undefined);
    expect(tenant.entries.get("test.Books").status).toMatch(/(NEW|OPEN)/);
    expect(tenant.entries.get("test.Books.texts").status).toBe("NEW");

    await cds.replicationCache.preload(undefined, ["test.Books", "test.Books.texts"]);

    tenant = await cds.replicationCache.entries.get(undefined);
    expect(tenant.entries.get("test.Books").status).toBe("READY");
    expect(tenant.entries.get("test.Books.texts").status).toBe("READY");

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
    expect(cds.replicationCache.stats.counts["test.Books.texts"]).toBe(2);
  });
});
