"use strict";

const cds = require("@sap/cds");

const { GET, test } = cds.test(__dirname + "/../..");

process.env.PORT = 0; // Random

cds.env.replicationCache.plugin = true;
cds.env.replicationCache.deploy = true;
cds.env.replicationCache.wait = true;
cds.env.replicationCache.credentials.database = ":memory:";

describe("Stats", () => {
  const log = cds.test.log();

  beforeEach(async () => {
    await test.data.reset();
    await cds.replicationCache.reset();
  });

  it("GET via db", async () => {
    await cds.tx(async (tx) => {
      const result = await tx.run(SELECT.from("test.Books", ["ID", "title", "author.name as name"]));
      expect(result.length).toBe(100);
      for (const row of result) {
        expect(row.ID).toEqual(expect.any(Number));
        expect(row.title).toEqual(expect.any(String));
      }
      expect(cds.replicationCache.stats).toEqual({
        counts: {
          "test.Authors": 1,
          "test.Books": 1,
        },
        errors: 0,
        hits: 1,
        localized: {},
        measureCount: 0,
        measureRatio: 0,
        measureTotal: 0,
        missed: 0,
        notRelevant: {},
        projections: {},
        ratio: 1,
        search: {},
        used: 1,
      });
      await cds.replicationCache.logStats();
      expect(log.output).toEqual(expect.stringMatching(/\[replicationCache] - Replication cache statistics/s));
      expect(log.output).toEqual(expect.stringMatching(/\[replicationCache] - Replication cache size 45056/s));
    });
  });

  it("Get via service", async () => {
    const response = await GET("/odata/v4/test/Books?$expand=author($select=name)");
    expect(response.data.value.length).toBe(100);
    for (const row of response.data.value) {
      expect(row.ID).toEqual(expect.any(Number));
      expect(row.title).toEqual(expect.any(String));
    }
    expect(cds.replicationCache.stats.used).toBe(1);
    expect(cds.replicationCache.stats.counts["test.Books"]).toBe(1);
    expect(cds.replicationCache.stats).toEqual({
      counts: {
        "test.Authors": 1,
        "test.Books": 1,
        "test.Books.texts": 1,
      },
      errors: 0,
      hits: 1,
      localized: {},
      measureCount: 0,
      measureRatio: 0,
      measureTotal: 0,
      missed: 0,
      notRelevant: {},
      projections: {},
      ratio: 1,
      search: {},
      used: 1,
    });
    await cds.replicationCache.logStats();
    expect(log.output).toEqual(expect.stringMatching(/\[replicationCache] - Replication cache statistics/s));
    expect(log.output).toEqual(expect.stringMatching(/\[replicationCache] - Replication cache size 65536/s));
  });
});
