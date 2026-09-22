"use strict";

const cds = require("@sap/cds");

const { client } = require("../mocks/redis");

process.env.PORT = 0; // Random

const { GET, data } = cds.test(__dirname + "/../..");

let rateLimiting;

cds.env.rateLimiting.plugin = true;

describe("Rate Limiting", () => {
  beforeAll(async () => {
    rateLimiting = cds.services.TestService.rateLimiting;
  });

  beforeEach(async () => {
    await data.reset();
    vi.clearAllMocks();
    await rateLimiting.resetWindow();
  });

  describe("Rate Limiting", () => {
    let delayImmediate = false;
    const immediate = async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    };

    beforeAll(async () => {
      // delay to parallelize
      cds.services.TestService.before("*", async (req) => {
        if (delayImmediate) {
          await immediate();
        }
        req.on("succeeded", async () => {
          if (delayImmediate) {
            await immediate();
          }
        });
        req.on("failed", async () => {
          if (delayImmediate) {
            await immediate();
          }
        });
      });
    });

    it("Restrict parallel request per tenant", async () => {
      delayImmediate = true;

      // 4 are too much
      const responsesToManyRequests = await Promise.allSettled([
        GET("/odata/v4/test/Books"),
        GET("/odata/v4/test/Books"),
        GET("/odata/v4/test/Books"),
        GET("/odata/v4/test/Books"),
      ]);

      const succeededRequests = responsesToManyRequests.filter(({ status }) => status === "fulfilled");
      const failedRequests = responsesToManyRequests.filter(({ status }) => status === "rejected");
      expect(failedRequests).toHaveLength(1);
      expect(succeededRequests).toHaveLength(3);
      expect(_axiosErrorToString(failedRequests[0].reason)).toEqual(
        "429 - Too many concurrent requests (max 3), please try again later.",
      );
      expect(succeededRequests.every(({ value: response }) => response.status === 200)).toEqual(true);

      // 3 are ok
      const responses = await Promise.all([
        GET("/odata/v4/test/Books"),
        GET("/odata/v4/test/Books"),
        GET("/odata/v4/test/Books"),
      ]);
      expect(responses.every((response) => response.status === 200)).toEqual(true);

      delayImmediate = false;
    });

    it("Restrict request per window", async () => {
      await rateLimiting.resetWindow();

      const response1 = await GET("/odata/v4/test/Books");
      expect(response1.headers["x-ratelimit-limit"]).toEqual("10000");
      expect(response1.headers["x-ratelimit-remaining"]).toEqual("9999");
      expect(response1.headers["x-ratelimit-reset"]).toBeDefined();
      expect(response1.headers["retry-after"]).toEqual("3600");
      expect(response1.headers["date"]).toBeDefined();

      const response2 = await GET("/odata/v4/test/Books");
      expect(response2.headers["x-ratelimit-limit"]).toEqual("10000");
      expect(response2.headers["x-ratelimit-remaining"]).toEqual("9998");
      expect(response2.headers["x-ratelimit-reset"]).toBeDefined();
      expect(response2.headers["retry-after"]).toEqual("3600");
      expect(response2.headers["date"]).toBeDefined();

      for (let i = 0; i < 10000; i++) {
        await rateLimiting.increment();
        await rateLimiting.decrement();
      }
      expect(await _catchAndSerializeAxiosErrorForSnapshot(GET("/odata/v4/test/Books"))).toMatchInlineSnapshot(
        `"429 - Too many requests in time window (max 10000), please try again later."`,
      );
      try {
        await GET("/odata/v4/test/Books");
      } catch (err) {
        expect(_axiosErrorToString(err)).toEqual(
          "429 - Too many requests in time window (max 10000), please try again later.",
        );
        expect(err.response.headers["x-ratelimit-limit"]).toEqual("10000");
        expect(err.response.headers["x-ratelimit-remaining"]).toEqual("0");
        expect(err.response.headers["x-ratelimit-reset"]).toBeDefined();
        expect(err.response.headers["retry-after"]).toEqual("3600");
        expect(err.response.headers["date"]).toBeDefined();
      }
      const date1 = await rateLimiting.resetTime();
      expect(date1).toBeDefined();

      // Simulate expiration
      await new Promise((resolve) => setTimeout(resolve, 5));
      client.del("rateLimiting:TestService:inWindowCounts/");
      client.del("rateLimiting:TestService:resetTime");

      const date2 = await rateLimiting.resetTime();
      expect(date2).toBeDefined();
      expect(date2.getTime()).toBeGreaterThan(date1.getTime());

      const response = await GET("/odata/v4/test/Books");
      expect(response.status).toEqual(200);
    });

    it("In-window counter to expire at the shared reset time", async () => {
      await rateLimiting.resetWindow();
      const reset = await rateLimiting.resetTime();
      client.pExpireAt.mockClear();
      await rateLimiting.increment("ttl-tenant");
      expect(client.pExpireAt).toHaveBeenCalledWith(
        "rateLimiting:TestService:inWindowCounts/ttl-tenant",
        reset.getTime(),
      );
      client.pExpireAt.mockClear();
      await rateLimiting.increment("ttl-tenant");
      expect(client.pExpireAt).toHaveBeenCalledWith(
        "rateLimiting:TestService:inWindowCounts/ttl-tenant",
        reset.getTime(),
      );
    });

    it("Coordinates reset time via set-if-absent rather than an elected instance", async () => {
      const first = await rateLimiting.resetTime();
      const second = await rateLimiting.resetTime();
      expect(second.getTime()).toEqual(first.getTime());
    });
  });
});

const _catchAndSerializeAxiosErrorForSnapshot = async (promiseThatRejects) => {
  try {
    await promiseThatRejects;
  } catch (err) {
    return _axiosErrorToString(err);
  }
  throw new Error("bad usage - must throw");
};

const _axiosErrorToString = (err) => `${err.response?.status} - ${err.response?.data?.error?.message}`;
