"use strict";

const cds = require("@sap/cds");

const { GET, test } = cds.test(__dirname + "/../..");

process.env.PORT = 0; // Random

const interval = 100;

cds.env.replicationCache.plugin = true;
cds.env.replicationCache.deploy = true;
cds.env.replicationCache.wait = true;
cds.env.replicationCache.prune = false;
cds.env.replicationCache.check = interval;
cds.env.replicationCache.size = 30000;
cds.env.replicationCache.credentials.database = ":memory:";

const wait = (duration) => {
  return new Promise((resolve) => setTimeout(resolve, duration));
};

describe("Check", () => {
  beforeEach(async () => {
    await test.data.reset();
    await cds.replicationCache.reset();
  });

  it("GET via db", async () => {
    await cds.tx(async (tx) => {
      cds.replicationCache.options.size = 30000;
      let result = await tx.run(SELECT.from("test.Books", ["ID", "title"]));
      expect(result.length).toBe(100);
      for (const row of result) {
        expect(row.ID).toEqual(expect.any(Number));
        expect(row.title).toEqual(expect.any(String));
      }
      expect(cds.replicationCache.stats.used).toBe(1);
      expect(cds.replicationCache.stats.counts["test.Books"]).toBe(1);

      expect(await cds.replicationCache.size()).toBe(24576);
      await wait(2 * interval);
      expect(await cds.replicationCache.size()).toBe(24576);

      const tenant = await cds.replicationCache.cache.get(undefined);
      expect(tenant.cache.get("test.Books").status).toBe("READY");

      result = await tx.run(SELECT.from("test.Authors", ["ID", "name"]));
      expect(result.length).toBe(100);
      for (const row of result) {
        expect(row.ID).toEqual(expect.any(Number));
        expect(row.name).toEqual(expect.any(String));
      }
      expect(cds.replicationCache.stats.used).toBe(2);
      expect(cds.replicationCache.stats.counts["test.Books"]).toBe(1);
      expect(cds.replicationCache.stats.counts["test.Authors"]).toBe(1);

      expect(await cds.replicationCache.size()).toBe(45056);
      await wait(2 * interval);
      expect(await cds.replicationCache.size()).toBe(20480);

      expect(tenant.cache.get("test.Books").status).toBe("OPEN");
      expect(tenant.cache.get("test.Authors").status).toBe("READY");
    });
  });

  it("Get via service", async () => {
    cds.replicationCache.options.size = 50000;
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
    expect(cds.replicationCache.stats.used).toBe(1);
    expect(cds.replicationCache.stats.counts["test.Books"]).toBe(1);
    expect(cds.replicationCache.stats.counts["test.Books.texts"]).toBe(1);

    expect(await cds.replicationCache.size()).toBe(45056);
    await wait(2 * interval);
    expect(await cds.replicationCache.size()).toBe(45056);

    const tenant = await cds.replicationCache.cache.get(undefined);
    expect(tenant.cache.get("test.Books").status).toBe("READY");
    expect(tenant.cache.get("test.Books.texts").status).toBe("READY");

    response = await GET("/odata/v4/test/Authors", {
      headers: {
        "Accept-Language": "en",
      },
    });
    expect(response.data.value.length).toBe(100);
    for (const row of response.data.value) {
      expect(row.ID).toEqual(expect.any(Number));
      expect(row.name).toEqual(expect.any(String));
    }
    expect(cds.replicationCache.stats.used).toBe(2);
    expect(cds.replicationCache.stats.counts["test.Books"]).toBe(1);
    expect(cds.replicationCache.stats.counts["test.Books.texts"]).toBe(1);
    expect(cds.replicationCache.stats.counts["test.Authors"]).toBe(1);

    expect(await cds.replicationCache.size()).toBe(65536);
    await wait(2 * interval);
    expect(await cds.replicationCache.size()).toBe(40960);

    expect(tenant.cache.get("test.Books").status).toBe("OPEN");
    expect(tenant.cache.get("test.Authors").status).toBe("READY");
  });
});
