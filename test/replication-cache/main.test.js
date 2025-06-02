"use strict";

const cds = require("@sap/cds");

const { GET, test } = cds.test(__dirname + "/../..");

process.env.PORT = 0; // Random

cds.env.replicationCache.plugin = true;
cds.env.replicationCache.deploy = true;
cds.env.replicationCache.wait = true;
cds.env.replicationCache.credentials.database = ":memory:";

describe("Main", () => {
  beforeEach(async () => {
    await test.data.reset();
    await cds.replicationCache.reset();
  });

  it("GET via db - sql", async () => {
    await cds.tx(async (tx) => {
      const result = await tx.run("SELECT * from test_Books where ID = ?", [1]);
      expect(result.length).toBe(1);
      expect(cds.replicationCache.stats.used).toBe(0);
      expect(cds.replicationCache.stats.counts["test.Books"]).toBeUndefined();
    });
  });

  it("GET via db - not replicated", async () => {
    await cds.tx(async (tx) => {
      const query = SELECT.one.from("test.Books");
      query.replicated = false;
      const result = await tx.run(query);
      expect(result).toBeDefined();
      expect(cds.replicationCache.stats.used).toBe(0);
      expect(cds.replicationCache.stats.counts["test.Books"]).toBeUndefined();
    });
  });

  it("GET via db - replication", async () => {
    await cds.tx(async (tx) => {
      const query = SELECT.one.from("test.Books");
      query.replication = true;
      const result = await tx.run(query);
      expect(result).toBeDefined();
      expect(cds.replicationCache.stats.used).toBe(0);
      expect(cds.replicationCache.stats.counts["test.Books"]).toBeUndefined();
    });
  });

  it("GET via db - not relevant", async () => {
    await cds.tx(async (tx) => {
      const result = await tx.run(SELECT.one.from("test.Quotes"));
      expect(result).toBeDefined();
      expect(cds.replicationCache.stats.used).toBe(0);
      expect(cds.replicationCache.stats.notRelevant["test.Quotes"]).toBeUndefined();
      expect(cds.replicationCache.stats.counts["test.Quotes"]).toBeUndefined();
    });
  });

  it("GET via db - partly not relevant", async () => {
    await cds.tx(async (tx) => {
      const result = await tx.run(SELECT.one.from("test.Pages", ["ID", "quotes.line as line"]));
      expect(result).toBeDefined();
      expect(cds.replicationCache.stats.used).toBe(0);
      expect(cds.replicationCache.stats.notRelevant["test.Pages"]).toBeUndefined();
      expect(cds.replicationCache.stats.notRelevant["test.Quotes"]).toBe(1);
      expect(cds.replicationCache.stats.counts["test.Pages"]).toBeUndefined();
      expect(cds.replicationCache.stats.counts["test.Quotes"]).toBeUndefined();
    });
  });

  it("GET via db - from", async () => {
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

  it("GET via db - definition", async () => {
    await cds.tx(async (tx) => {
      const result = await tx.run(SELECT.from(cds.model.definitions["test.Books"], ["ID", "title"]));
      expect(result.length).toBe(100);
      for (const row of result) {
        expect(row.ID).toEqual(expect.any(Number));
        expect(row.title).toEqual(expect.any(String));
      }
      expect(cds.replicationCache.stats.used).toBe(1);
      expect(cds.replicationCache.stats.counts["test.Books"]).toBe(1);
    });
  });

  it("GET via db - navigation", async () => {
    await cds.tx(async (tx) => {
      const result = await tx.run(SELECT.from({ ref: ["test.Books", "pages"] }, ["ID", "no"]));
      expect(result.length).toBe(739);
      for (const row of result) {
        expect(row.ID).toEqual(expect.any(Number));
        expect(row.no).toEqual(expect.any(Number));
      }
      expect(cds.replicationCache.stats.used).toBe(1);
      expect(cds.replicationCache.stats.counts["test.Books"]).toBe(1);
      expect(cds.replicationCache.stats.counts["test.Pages"]).toBe(1);
    });
  });

  it("GET via db - texts", async () => {
    await cds.tx(async (tx) => {
      const result = await tx.run(SELECT.from({ ref: ["test.Books", "texts"] }, ["ID", "title"]));
      expect(result.length).toBe(47);
      for (const row of result) {
        expect(row.ID).toEqual(expect.any(Number));
        expect(row.title).toEqual(expect.any(String));
      }
      expect(cds.replicationCache.stats.used).toBe(1);
      expect(cds.replicationCache.stats.counts["test.Books"]).toBe(1);
      expect(cds.replicationCache.stats.counts["test.Books.texts"]).toBe(1);
    });
  });

  it("GET via db - limit", async () => {
    await cds.tx(async (tx) => {
      const result = await tx.run(SELECT.one.from("test.Books", ["ID", "title"]).limit(1, 10));
      expect(result).toMatchObject({
        ID: 11,
        title: "Especially fund baby have several",
      });
      expect(cds.replicationCache.stats.used).toBe(1);
      expect(cds.replicationCache.stats.counts["test.Books"]).toBe(1);
    });
  });

  it("GET via db - localized", async () => {
    await cds.tx({ locale: "de" }, async (tx) => {
      const result = await tx.run(SELECT.one.localized("test.Books", ["ID", "title"]).where({ ID: 3 }));
      expect(result).toMatchObject({
        ID: 3,
        title: "Schwarze dunkle Investition",
      });
      expect(cds.replicationCache.stats.used).toBe(1);
      expect(cds.replicationCache.stats.counts["test.Books"]).toBe(1);
    });
  });

  it("GET via db - nested", async () => {
    await cds.tx(async (tx) => {
      const result = await tx.run(SELECT.from(SELECT.from("test.Books"), ["ID", "title"]));
      expect(result.length).toBe(100);
      for (const row of result) {
        expect(row.ID).toEqual(expect.any(Number));
        expect(row.title).toEqual(expect.any(String));
      }
      expect(cds.replicationCache.stats.used).toBe(1);
      expect(cds.replicationCache.stats.counts["test.Books"]).toBe(1);
    });
  });

  it("GET via db - association", async () => {
    await cds.tx(async (tx) => {
      const result = await tx.run(SELECT.from("test.Books", ["ID", "title", "author.name as name"]));
      expect(result.length).toBe(100);
      for (const row of result) {
        expect(row.ID).toEqual(expect.any(Number));
        expect(row.title).toEqual(expect.any(String));
        expect(row.name).toEqual(expect.any(String));
      }
      expect(cds.replicationCache.stats.used).toBe(1);
      expect(cds.replicationCache.stats.counts["test.Books"]).toBe(1);
      expect(cds.replicationCache.stats.counts["test.Authors"]).toBe(1);
    });
  });

  it("GET via db - composition", async () => {
    await cds.tx(async (tx) => {
      const result = await tx.run(SELECT.from("test.Books", ["ID", "title", "pages.no as no"]));
      expect(result.length).toBe(739);
      for (const row of result) {
        expect(row.ID).toEqual(expect.any(Number));
        expect(row.title).toEqual(expect.any(String));
        expect(row.no).toEqual(expect.any(Number));
      }
      expect(cds.replicationCache.stats.used).toBe(1);
      expect(cds.replicationCache.stats.counts["test.Books"]).toBe(1);
      expect(cds.replicationCache.stats.counts["test.Pages"]).toBe(1);
    });
  });

  it("GET via db - join", async () => {
    await cds.tx(async (tx) => {
      const result = await tx.run(
        SELECT.from("test.Books as b", ["b.ID as ID", "b.title as title", "a.name as name"])
          .join("test.Authors as a")
          .on("b.author_ID = a.ID"),
      );
      expect(result.length).toBe(100);
      for (const row of result) {
        expect(row.ID).toEqual(expect.any(Number));
        expect(row.title).toEqual(expect.any(String));
        expect(row.name).toEqual(expect.any(String));
      }
      expect(cds.replicationCache.stats.used).toBe(1);
      expect(cds.replicationCache.stats.counts["test.Books"]).toBe(1);
      expect(cds.replicationCache.stats.counts["test.Authors"]).toBe(1);
    });
  });

  it("GET via db - where", async () => {
    await cds.tx(async (tx) => {
      const result = await tx.run(SELECT.from("test.Books", ["ID", "title"]).where("title like '%test%'"));
      expect(result).toMatchObject([
        {
          ID: 92,
          title: "Green in test",
        },
      ]);
      expect(result.length).toBe(1);
      expect(cds.replicationCache.stats.used).toBe(1);
      expect(cds.replicationCache.stats.counts["test.Books"]).toBe(1);
    });
  });

  it("GET via db - where association", async () => {
    await cds.tx(async (tx) => {
      const result = await tx.run(SELECT.from("test.Books", ["ID", "title"]).where("author.name like '%Steven%'"));
      expect(result).toMatchObject([
        {
          ID: 10,
          title: "Pm worker ever energy",
        },
        {
          ID: 77,
          title: "Scene member forward money",
        },
      ]);
      expect(cds.replicationCache.stats.used).toBe(1);
      expect(cds.replicationCache.stats.counts["test.Books"]).toBe(1);
      expect(cds.replicationCache.stats.counts["test.Authors"]).toBe(1);
    });
  });

  it("GET via db - where association nested", async () => {
    await cds.tx(async (tx) => {
      const result = await tx.run(
        SELECT.distinct
          .from("test.Books", ["ID", "title"])
          .where("(author.name like '%Steven%') or (pages.content like '%Town view%')"),
      );
      expect(result).toMatchObject([
        {
          ID: 2,
          title: "Attorney focus skill issue",
        },
        {
          ID: 10,
          title: "Pm worker ever energy",
        },
        {
          ID: 77,
          title: "Scene member forward money",
        },
      ]);
      expect(cds.replicationCache.stats.used).toBe(1);
      expect(cds.replicationCache.stats.counts["test.Books"]).toBe(1);
      expect(cds.replicationCache.stats.counts["test.Authors"]).toBe(1);
      expect(cds.replicationCache.stats.counts["test.Pages"]).toBe(1);
    });
  });

  it("GET via db - where exists", async () => {
    await cds.tx(async (tx) => {
      const result = await tx.run(
        SELECT.from("test.Books", ["ID", "title"]).where("exists", SELECT.from("test.Pages").where("ID = 10")),
      );
      expect(result.length).toBe(100);
      for (const row of result) {
        expect(row.ID).toEqual(expect.any(Number));
        expect(row.title).toEqual(expect.any(String));
      }
      expect(cds.replicationCache.stats.used).toBe(1);
      expect(cds.replicationCache.stats.counts["test.Books"]).toBe(1);
    });
  });

  it("GET via db - sort", async () => {
    await cds.tx(async (tx) => {
      const result = await tx.run(
        SELECT.from("test.Books", ["ID", "title"]).where("title like '%every%'").orderBy("ID desc"),
      );
      expect(result.length).toBe(3);
      expect(result).toMatchObject([
        {
          ID: 94,
          title: "Seat his everything",
        },
        {
          ID: 52,
          title: "Wide line true everybody",
        },
        {
          ID: 32,
          title: "Apply every teacher drop",
        },
      ]);
      expect(cds.replicationCache.stats.used).toBe(1);
      expect(cds.replicationCache.stats.counts["test.Books"]).toBe(1);
    });
  });

  it("GET via db - sort association", async () => {
    await cds.tx(async (tx) => {
      const result = await tx.run(
        SELECT.from("test.Books", ["ID", "title"]).where("title like '%every%'").orderBy("author.name desc"),
      );
      expect(result.length).toBe(3);
      expect(result).toMatchObject([
        {
          ID: 52,
          title: "Wide line true everybody",
        },
        {
          ID: 32,
          title: "Apply every teacher drop",
        },
        {
          ID: 94,
          title: "Seat his everything",
        },
      ]);
      expect(cds.replicationCache.stats.used).toBe(1);
      expect(cds.replicationCache.stats.counts["test.Books"]).toBe(1);
    });
  });

  it("Get via service - from", async () => {
    const response = await GET("/odata/v4/test/Books", {
      headers: {
        "Accept-Language": "en",
      },
    });
    expect(response.data.value.length).toBe(100);
    expect(cds.replicationCache.stats.used).toBe(1);
    expect(cds.replicationCache.stats.counts["test.Books"]).toBe(1);
  });

  it("Get via service - search", async () => {
    const response = await GET("/odata/v4/test/Books?$search=test", {
      headers: {
        "Accept-Language": "en",
      },
    });
    expect(response.data.value.length).toBe(1);
    expect(cds.replicationCache.stats.used).toBe(1);
    expect(cds.replicationCache.stats.search["TestService.Books"]).toBeUndefined();
    expect(cds.replicationCache.stats.counts["test.Books"]).toBe(1);
  });

  it("Get via service - navigation", async () => {
    const response = await GET("/odata/v4/test/Books(1)/pages", {
      headers: {
        "Accept-Language": "en",
      },
    });
    expect(response.data.value.length).toBe(5);
    expect(cds.replicationCache.stats.used).toBe(1);
    expect(cds.replicationCache.stats.counts["test.Books"]).toBe(1);
  });

  it("Get via service - texts", async () => {
    const response = await GET("/odata/v4/test/Books(1)/texts", {
      headers: {
        "Accept-Language": "en",
      },
    });
    expect(response.data.value.length).toBe(2);
    expect(cds.replicationCache.stats.used).toBe(1);
    expect(cds.replicationCache.stats.counts["test.Books"]).toBe(1);
    expect(cds.replicationCache.stats.counts["test.Books.texts"]).toBe(1);
  });

  it("Get via service - expand", async () => {
    const response = await GET("/odata/v4/test/Books?$expand=author($select=name)", {
      headers: {
        "Accept-Language": "en",
      },
    });
    expect(response.data.value.length).toBe(100);
    for (const entry of response.data.value) {
      expect(entry.ID).toEqual(expect.any(Number));
      expect(entry.title).toEqual(expect.any(String));
      expect(entry.title).toEqual(expect.any(String));
      expect(entry.author.name).toEqual(expect.any(String));
    }
    expect(cds.replicationCache.stats.used).toBe(1);
    expect(cds.replicationCache.stats.counts["test.Books"]).toBe(1);
  });
});
