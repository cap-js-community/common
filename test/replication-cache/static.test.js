"use strict";

const cds = require("@sap/cds");

const { GET, test } = cds.test(__dirname + "/../..");

process.env.PORT = 0; // Random

cds.env.replicationCache.plugin = true;
cds.env.replicationCache.wait = true;
cds.env.replicationCache.preload = true;
cds.env.replicationCache.credentials.database = ":memory:";

describe("Static", () => {
  beforeEach(async () => {
    await test.data.reset();
    await cds.replicationCache.reset();
  });

  it("GET via db", async () => {
    await cds.tx({ tenant: "t1" }, async (tx) => {
      let result = await tx.run(SELECT.from("test.Enum", ["name", "descr"]));
      expect(result.length).toBe(6);
      for (const row of result) {
        expect(row.name).toEqual(expect.any(String));
        expect(row.descr).toEqual(expect.any(String));
      }
      expect(cds.replicationCache.stats.used).toBe(1);
      expect(cds.replicationCache.stats.counts["test.Enum"]).toBe(1);
      expect(cds.replicationCache.cache.get(undefined)).toBeDefined();
      expect(cds.replicationCache.cache.get("t1")).not.toBeDefined();

      result = await tx.run(SELECT.from("test.EnumView", ["name", "descr"]));
      expect(cds.replicationCache.cache.get("t1")).toBeDefined();
    });
  });

  it("Get via service", async () => {
    const response = await GET("/odata/v4/test/Enum", {
      headers: {
        "Accept-Language": "en",
      },
    });
    expect(response.data.value.length).toBe(6);
    for (const row of response.data.value) {
      expect(row.name).toEqual(expect.any(String));
      expect(row.descr).toEqual(expect.any(String));
    }
    expect(cds.replicationCache.stats.used).toBe(1);
    expect(cds.replicationCache.stats.counts["test.Enum"]).toBe(1);
  });
});
