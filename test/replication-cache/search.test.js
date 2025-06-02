"use strict";

const cds = require("@sap/cds");

const { GET, test } = cds.test(__dirname + "/../..");

process.env.PORT = 0; // Random

cds.env.replicationCache.plugin = true;
cds.env.replicationCache.deploy = true;
cds.env.replicationCache.wait = true;
cds.env.replicationCache.search = false;
cds.env.replicationCache.credentials.database = ":memory:";

describe("Search", () => {
  beforeEach(async () => {
    await test.data.reset();
    await cds.replicationCache.reset();
  });

  it("Get via service - search", async () => {
    const response = await GET("/odata/v4/test/Books?$search=test", {
      headers: {
        "Accept-Language": "en",
      },
    });
    expect(response.data.value.length).toBe(1);
    expect(cds.replicationCache.stats.used).toBe(0);
    expect(cds.replicationCache.stats.search["TestService.Books"]).toBe(1);
    expect(cds.replicationCache.stats.counts["test.Books"]).toBeUndefined();
  });
});
