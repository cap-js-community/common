"use strict";

const cds = require("@sap/cds");

const redisCounter = require("./redis/counter");
const redisResetTime = require("./redis/resetTime");

const { connectionCheck } = require("./redis/common");

const COMPONENT_NAME = "/cap-js-community-common/rate-limiting";

class RateLimiting {
  constructor(service, { maxConcurrent, maxInWindow, window } = {}) {
    this.log = cds.log(COMPONENT_NAME);
    this.service = service;
    this.id = service.name;
    this.resetTime = null;
    this.tenantCounts = {}; // [<tenant>: {concurrent: 0, window: 0}]
    this.maxConcurrent =
      maxConcurrent || service.definition["@cds.rateLimiting.maxConcurrent"] || cds.env.rateLimiting.maxConcurrent;
    this.maxInWindow =
      maxInWindow || service.definition["@cds.rateLimiting.maxInWindow"] || cds.env.rateLimiting.maxInWindow;
    this.window = window || service.definition["@cds.rateLimiting.window"] || cds.env.rateLimiting.window;
    this.redisActive = cds.env.rateLimiting.redis;
  }

  async setup() {
    if (this.redisActive && !(await connectionCheck())) {
      this.redisActive = cds.env.rateLimiting.redis = false;
    }
    this.redisTenantInWindowCounts = redisCounter({
      name: `rateLimiting:${this.id}:inWindowCounts`,
    });
    this.redisTenantResetTime = redisResetTime({
      name: `rateLimiting:${this.id}:resetTime`,
    });
    this.monitor(this.service);
    this.log.info("using rate limiting", {
      service: this.service.name,
      maxConcurrent: this.maxConcurrent,
      maxInWindow: this.maxInWindow,
      window: this.window,
      redis: this.redisActive,
    });
  }

  initTenant(tenant) {
    tenant = tenant || "";
    this.tenantCounts[tenant] = this.tenantCounts[tenant] || { concurrent: 0, window: 0 };
    return tenant;
  }

  async calcResetTime() {
    this.resetTime = new Date();
    this.resetTime.setMilliseconds(this.resetTime.getMilliseconds() + this.window);
    await (await this.redisTenantResetTime).set(this.resetTime);
    return this.resetTime;
  }

  async nextResetTime() {
    this.resetTime = await (await this.redisTenantResetTime).get();
    if (this.resetTime) {
      return this.resetTime;
    }
    return await this.calcResetTime();
  }

  async increment(tenant) {
    tenant = this.initTenant(tenant);
    const concurrentCount = this.tenantCounts[tenant].concurrent + 1;
    this.tenantCounts[tenant].concurrent = concurrentCount;
    const inWindowCount = await (await this.redisTenantInWindowCounts).increment(tenant);
    this.tenantCounts[tenant].window = inWindowCount;
    return {
      ok: concurrentCount <= this.maxConcurrent && inWindowCount <= this.maxInWindow,
      count: {
        concurrent: concurrentCount,
        inWindow: inWindowCount,
      },
      exceeds: {
        concurrent: concurrentCount > this.maxConcurrent,
        inWindow: inWindowCount > this.maxInWindow,
      },
    };
  }

  async decrement(tenant) {
    tenant = this.initTenant(tenant);
    const concurrentCount = this.tenantCounts[tenant].concurrent - 1;
    this.tenantCounts[tenant].concurrent = Math.max(concurrentCount, 0);
  }

  async clearInWindow(tenant) {
    tenant = this.initTenant(tenant);
    this.tenantCounts[tenant].window = await (await this.redisTenantInWindowCounts).reset(tenant);
  }

  async clearAllInWindow() {
    await this.calcResetTime();
    await Promise.allDone(
      Object.keys(this.tenantCounts).map(async (tenant) => {
        await this.clearInWindow(tenant);
      }),
    );
  }

  isExternal(req) {
    return !!req.protocol?.match(/rest|odata/);
  }

  monitor(srv) {
    srv.rateLimiting = this;

    if (parseInt(process.env.CF_INSTANCE_INDEX) === 0) {
      (async () => {
        try {
          await this.calcResetTime();
        } catch (err) {
          this.log.error("Resetting rate limit time failed", err);
        }
        setInterval(async () => {
          try {
            await this.clearAllInWindow();
          } catch (err) {
            this.log.error("Resetting rate limit window failed", err);
          }
        }, this.window).unref();
      })();
    }

    srv.before("*", async (req) => {
      if (!req.http?.req) {
        return;
      }

      // decrement
      req.on("succeeded", async () => {
        if (this.isExternal(req)) {
          await this.decrement(req.tenant);
        }
      });
      req.on("failed", async () => {
        if (this.isExternal(req)) {
          await this.decrement(req.tenant);
        }
      });

      // increment
      if (this.isExternal(req)) {
        try {
          const status = await this.increment(req.tenant);
          if (status.ok) {
            await this.accept(req, status);
          } else {
            await this.reject(req, status);
          }
        } catch (err) {
          this.log.error("Incrementing rate limit counter failed", err);
          await this.reject(req, { ok: false });
        }
      }
    });
  }

  async accept(req, status) {
    try {
      await this.addHeaders(req, status.count);
    } catch (err) {
      this.log.error("Adding rate limit headers failed", err);
      await this.reject(req, { ok: false });
    }
  }

  async reject(req, status) {
    try {
      await this.addHeaders(req, status.count);
    } catch (err) {
      this.log.error("Adding rate limit headers failed", err);
    }
    if (status.exceeds?.inWindow) {
      req.error({
        code: "TOO_MANY_REQUESTS",
        status: 429,
        statusCode: 429,
        message: `Too many requests in time window (max ${this.maxInWindow}), please try again later.`,
      });
    } else if (status.exceeds?.concurrent) {
      req.error({
        code: "TOO_MANY_REQUESTS",
        status: 429,
        statusCode: 429,
        message: `Too many concurrent requests (max ${this.maxConcurrent}), please try again later.`,
      });
    } else {
      req.error({
        code: "TOO_MANY_REQUESTS",
        status: 429,
        statusCode: 429,
        message: "Too many requests, please try again later.",
      });
    }
  }

  async addHeaders(req, count) {
    const response = req.http.res;
    if (response && !response.headersSent) {
      response.setHeader("X-RateLimit-Limit", this.maxInWindow);
      response.setHeader("X-RateLimit-Remaining", Math.max(this.maxInWindow - count.inWindow, 0));
      response.setHeader("X-RateLimit-Reset", Math.ceil((await this.nextResetTime()).getTime() / 1000));
      response.setHeader("Retry-After", Math.ceil(this.window / 1000));
      response.setHeader("Date", new Date().toUTCString());
    }
  }
}

module.exports = RateLimiting;
