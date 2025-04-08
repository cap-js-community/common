"use strict";

const cds = require("@sap/cds");

const { GET, test } = cds.test(__dirname + "/../..");

process.env.PORT = 0; // Random

cds.env.replicationCache.plugin = true;
cds.env.replicationCache.deploy = true;
cds.env.replicationCache.wait = true;
cds.env.replicationCache.credentials.database = ":memory:";

describe("Size", () => {
  beforeEach(async () => {
    await test.data.reset();
    await cds.replicationCache.reset();
    cds.replicationCache.cache = new Map();
  });

  it("GET via db - single ref", async () => {
    await cds.tx(async (tx) => {
      const result = await tx.run(SELECT.from("test.Books", ["ID", "title"]));
      expect(result.length).toBe(100);
      for (const row of result) {
        expect(row.ID).toEqual(expect.any(Number));
        expect(row.title).toEqual(expect.any(String));
      }
      expect(cds.replicationCache.stats.used).toBe(1);
      expect(cds.replicationCache.stats.counts["test.Books"]).toBe(1);
      expect(await cds.replicationCache.tenantSize()).toBe(126976);
      expect(await cds.replicationCache.size()).toBe(24576);
      expect(await cds.replicationCache.size(undefined, "test.Books")).toBe(24576);
    });
  });

  it("GET via db - multiple refs", async () => {
    await cds.tx(async (tx) => {
      const result = await tx.run(SELECT.from("test.Books", ["ID", "title", "author.name as name", "pages.no as no"]));
      expect(result.length).toBe(739);
      for (const row of result) {
        expect(row.ID).toEqual(expect.any(Number));
        expect(row.title).toEqual(expect.any(String));
      }
      expect(cds.replicationCache.stats.used).toBe(1);
      expect(cds.replicationCache.stats.counts["test.Books"]).toBe(1);
      expect(cds.replicationCache.stats.counts["test.Authors"]).toBe(1);
      expect(cds.replicationCache.stats.counts["test.Pages"]).toBe(1);
      expect(await cds.replicationCache.tenantSize()).toBe(282624);
      expect(await cds.replicationCache.size()).toBe(188416);
      expect(await cds.replicationCache.size(undefined, "test.Books")).toBe(24576);
      expect(await cds.replicationCache.size(undefined, "test.Authors")).toBe(20480);
      expect(await cds.replicationCache.size(undefined, "test.Pages")).toBe(143360);
    });
  });

  it("Get via service", async () => {
    const response = await GET("/odata/v4/test/Books");
    expect(response.data.value.length).toBe(100);
    for (const row of response.data.value) {
      expect(row.ID).toEqual(expect.any(Number));
      expect(row.title).toEqual(expect.any(String));
    }
    expect(cds.replicationCache.stats.used).toBe(1);
    expect(cds.replicationCache.stats.counts["test.Books"]).toBe(1);
    expect(cds.replicationCache.stats.counts["test.Books.texts"]).toBe(1);
    expect(await cds.replicationCache.tenantSize()).toBe(143360);
    expect(await cds.replicationCache.size()).toBe(45056);
    expect(await cds.replicationCache.size(undefined, "test.Books")).toBe(24576);
    expect(await cds.replicationCache.size(undefined, "test.Books.texts")).toBe(20480);
  });
});
