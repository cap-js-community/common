"use strict";

const os = require("os");
const path = require("path");
const fs = require("fs").promises;

const cds = require("@sap/cds");
const SQLiteService = require("@cap-js/sqlite");

require("../common/promise");

const Component = "replicationCache";

const Constants = {
  InMemory: ":memory:",
  Default: "default",
};

const Status = {
  New: "NEW",
  Initialized: "INITIALIZED",
  NotReady: "NOT_READY",
  Ready: "READY",
  Open: "OPEN",
  Failed: "FAILED",
  Invalid: "INVALID",
};

const Annotations = {
  Replicate: "@cds.replicate",
  ReplicateGroup: "@cds.replicate.group",
  ReplicateAuto: "@cds.replicate.auto",
  ReplicateTTL: "@cds.replicate.ttl",
  ReplicatePreload: "@cds.replicate.preload",
};

const Tenant = {
  Default: "default",
  Template: "template",
};

class ReplicationCache {
  constructor(options) {
    this.options = {
      ...(cds.env.replicationCache || {}),
      ...options,
      tmpDirPath: os.tmpdir(),
    };
    this.name = this.options.name;
    this.group = this.options.group;
    this.log = cds.log(Component);
    this.template = null;
    this.cache = new Map();
    this.initStats();
    this.attach();
  }

  attach() {
    cds.on("loaded", (model) => {
      this.model = model;
    });
    cds.on("connect", (service) => {
      if (service.name === this.name) {
        const refs = ReplicationCache.replicationRefs(this.model, service);
        if (refs.length > 0) {
          this.setup(service, refs);
          this.log.info("using replication cache", {
            service: service.name,
          });
          if (
            this.options.deploy &&
            this.options?.credentials?.database &&
            this.options?.credentials?.database !== Constants.InMemory
          ) {
            this.log.debug("Preparing replication cache template database");
            this.template = createDB(Tenant.Template, this.model, this.options).catch((err) => {
              this.log.error("Preparing replication cache failed", err);
            });
          }
        }
      }
    });
  }

  static replicationRefs(model, service) {
    const refs = Object.keys(model.definitions).filter((name) => {
      const definition = model.definitions[name];
      return (
        definition.kind === "entity" &&
        !definition.projection &&
        (service.name === "db" || name.startsWith(`${service.name}.`)) &&
        Object.values(Annotations).find((annotation) => {
          return definition[annotation] !== undefined;
        })
      );
    });
    if (refs) {
      for (const ref of refs) {
        if (model.definitions[`${ref}.texts`]) {
          refs.push(`${ref}.texts`);
        }
      }
    }
    return refs;
  }

  initStats() {
    this.stats = {
      hits: 0,
      used: 0,
      missed: 0,
      errors: 0,
      ratio: 0,
      measureTotal: 0,
      measureCount: 0,
      measureRatio: 0,
      counts: {}, // <String, Number>
      search: {}, // <String, Number>
      localized: {}, // <String, Number>
      projections: {}, // <String, Number>
      notRelevant: {}, // <String, Number>
    };
  }

  setup(service, refs) {
    this.service = service;
    this.refs = refs.reduce((result, ref) => {
      result[ref] = true;
      return result;
    }, {});
    this.service.prepend(() => {
      this.service.on("READ", this.read.bind(this));
    });
    if (this.options.check > 0) {
      setInterval(async () => {
        try {
          await this.prune();
        } catch (err) {
          this.log.error("Pruning replication cache failed", err);
        }
      }, this.options.check).unref();
    }
    if (this.options.stats > 0) {
      setInterval(async () => {
        try {
          await this.logStats();
        } catch (err) {
          this.log.error("Logging replication cache statistics failed", err);
        }
      }, this.options.stats).unref();
    }
  }

  async read(req, next) {
    try {
      if (req.query.replication === true || req.query.replicated === false) {
        return await next();
      }
      if (!(await this.active(req.tenant))) {
        return await next();
      }
      this.stats.hits++;
      const model = req.model ?? cds.model;
      if (this.options.preload) {
        req.on("done", () => {
          this.preloadAnnotated(req.tenant, model);
        });
      }
      if (!this.options.search && !this.search(req.query)) {
        return await next();
      }
      let refs = queryRefs(model, req.query);
      if (!this.options.deploy) {
        if (!this.localized(req.query, refs)) {
          return await next();
        }
        if (!this.projections(model, refs)) {
          return await next();
        }
      }
      if (this.options.deploy) {
        refs = baseRefs(model, refs);
        refs = localizedRefs(model, req.query, refs);
      }
      if (refs.length === 0 || !this.relevant(refs)) {
        return await next();
      }
      for (const ref of refs) {
        this.stats.counts[ref] ??= 0;
        this.stats.counts[ref]++;
      }
      const status = await this.load(
        req.tenant,
        refs,
        {
          auto: this.options.auto,
          wait: this.options.wait,
          thread: true,
        },
        model,
      );
      if (status === Status.Ready) {
        this.stats.used++;
        this.stats.ratio = Math.round(this.stats.used / this.stats.hits);
        this.log.debug("Replication cache was used");
        const db = this.cache.get(req.tenant).db;
        if (this.options.measure) {
          return this.measure(
            async () => {
              return db.tx({ ...req.context }, async (tx) => {
                return tx.run(req.query);
              });
            },
            async () => {
              await next();
            },
          );
        }
        return db.tx(
          {
            tenant: req.context.tenant,
            locale: req.context.locale,
            user: req.context.user,
            http: req.context.http,
          },
          async (tx) => {
            return tx.run(req.query);
          },
        );
      }
    } catch (err) {
      this.stats.errors++;
      this.log.error("Reading from replication cache failed", err);
    }
    this.stats.missed++;
    this.stats.ratio = Math.round(this.stats.used / this.stats.hits);
    this.log.debug("Replication cache was not used");
    return await next();
  }

  relevant(refs) {
    const notRelevantRefs = refs.filter((ref) => !this.refs[ref]);
    if (notRelevantRefs.length === refs.length) {
      this.log.debug("Replication cache not relevant for query including refs", {
        refs,
      });
      return false;
    }
    if (notRelevantRefs.length > 0) {
      for (const ref of notRelevantRefs) {
        this.stats.notRelevant[ref] ??= 0;
        this.stats.notRelevant[ref]++;
        this.log.debug("Replication cache not relevant for query including ref", {
          ref,
          refs,
        });
      }
      return false;
    }
    return true;
  }

  async preloadAnnotated(tenant, model, preloadRefs) {
    try {
      const refs = [];
      for (const ref in this.refs) {
        if (preloadRefs && !preloadRefs.includes(ref)) {
          continue;
        }
        const definition = model.definitions[ref];
        if (definition[Annotations.ReplicatePreload]) {
          refs.push(ref);
        }
      }
      await this.preload(tenant, refs, model);
    } catch (err) {
      this.log.error("Preload replication cache failed", err);
    }
  }

  async preload(tenant, refs, model) {
    if (refs.length === 0) {
      return;
    }
    return await this.load(tenant, refs, { auto: true, wait: true, thread: false }, model ?? cds.model);
  }

  async load(tenant, refs, options, model = cds.model) {
    refs = Array.isArray(refs) ? refs : [refs];
    refs = refs.filter((ref) => !model.definitions[ref].query);
    if (refs.length === 0) {
      return;
    }
    let tenantCache = cached(this.cache, tenant, async () => {
      return new ReplicationCacheTenant(tenant, model, this.options).prepare();
    });
    return (async () => {
      try {
        const prepared = Promise.resolve(tenantCache).then(async (tenantCache) => {
          const prepares = [];
          for (const ref of refs) {
            const entry = cached(tenantCache.cache, ref, () => {
              return new ReplicationCacheEntry(this, tenantCache, ref);
            });
            entry.touched = Date.now();
            if (
              entry.status !== Status.Ready &&
              !(options?.auto === false) &&
              !(model.definitions[ref]?.[Annotations.ReplicateAuto] === false)
            ) {
              prepares.push(entry.prepare(options?.wait && options?.thread));
            }
          }
          return await Promise.allDone(prepares);
        });
        if (!(options?.wait === false)) {
          await prepared;
          tenantCache = await tenantCache;
        }
        if (!(tenantCache instanceof ReplicationCacheTenant)) {
          return Status.NotReady;
        }
        for (const ref of refs) {
          const entry = tenantCache.cache.get(ref);
          if (!entry || entry.status !== Status.Ready) {
            return Status.NotReady;
          }
        }
        return Status.Ready;
      } catch (err) {
        this.stats.errors++;
        this.log.error("Preparing replication cache entry failed", err);
        return Status.NotReady;
      }
    })();
  }

  async prepared(tenant, ref) {
    const tenants = tenant ? [tenant] : this.cache.keys();
    for (const id of tenants) {
      const tenant = await this.cache.get(id);
      if (tenant) {
        const refs = ref ? [ref] : tenant.cache.keys();
        for (const ref of refs) {
          const entry = tenant.cache.get(ref);
          if (entry) {
            await entry.prepared;
          }
        }
      }
    }
  }

  async clear(tenant, ref) {
    const tenants = tenant ? [tenant] : this.cache.keys();
    for (const id of tenants) {
      const tenant = await this.cache.get(id);
      if (tenant) {
        const refs = ref ? [ref] : tenant.cache.keys();
        for (const ref of refs) {
          const entry = tenant.cache.get(ref);
          if (entry) {
            await entry.clear();
            this.log.debug("Replication cache cleared", {
              tenant,
              ref,
              size: entry.size,
              touched: entry.touched,
            });
          }
        }
      }
    }
  }

  async reset() {
    this.initStats();
    await this.clear();
  }

  async prune(tenant) {
    const maxSize = this.options.size / this.cache.size;
    const tenants = tenant ? [tenant] : this.cache.keys();
    for (const id of tenants) {
      const tenant = await this.cache.get(id);
      const size = await this.size(tenant.id);
      let diff = size - maxSize;
      if (diff > 0) {
        this.log.debug("Replication cache exceeds limit for tenant", {
          tenant,
          diff,
        });
        const refs = [...tenant.cache.keys()];
        refs.sort((ref1, ref2) => tenant.cache.get(ref1).touched - tenant.cache.get(ref2).touched);
        const pruneRefs = [];
        for (const ref of refs) {
          pruneRefs.push(ref);
          const entry = tenant.cache.get(ref);
          if (entry) {
            diff -= entry.size;
            if (diff <= 0) {
              break;
            }
          }
        }
        for (const ref of pruneRefs) {
          const entry = tenant.cache.get(ref);
          this.log.debug("Replication cache prunes ref for tenant", {
            tenant,
            ref,
            size: entry.size,
            touched: entry.touched,
          });
          await entry.clear(tenant, ref);
        }
      }
    }
  }

  async size(tenant, ref) {
    let size = 0;
    const tenants = tenant ? [tenant] : this.cache.keys();
    for (const id of tenants) {
      const tenant = await this.cache.get(id);
      if (tenant) {
        const refs = ref ? [ref] : tenant.cache.keys();
        for (const ref of refs) {
          const entry = tenant.cache.get(ref);
          if (entry) {
            size += entry.size;
          }
        }
      }
    }
    return size;
  }

  async tenantSize(id) {
    const tenant = await this.cache.get(id);
    if (tenant) {
      return await tenant.db.tx(async (tx) => {
        const result = await tx.run(
          "select page_size * page_count as bytes from pragma_page_count(), pragma_page_size()",
        );
        return result[0]?.bytes ?? 0;
      });
    }
    return 0;
  }

  async measure(fnCache, fnService) {
    let timeCache = 0;
    let timeService = 0;
    const [cacheResult] = await Promise.allDone([
      (async () => {
        const start = performance.now();
        const result = await fnCache();
        const end = performance.now();
        timeCache = end - start;
        return result;
      })(),
      (async () => {
        const start = performance.now();
        const result = await fnService();
        const end = performance.now();
        timeService = end - start;
        return result;
      })(),
    ]);
    const percent = ((timeService - timeCache) / timeService) * 100;
    this.log.info("Replication cache measurement", Math.round(percent), timeCache, timeService);
    this.stats.measureTotal += percent;
    this.stats.measureCount += 1;
    this.stats.measureRatio = Math.round(this.stats.measureTotal / this.stats.measureCount);
    return cacheResult;
  }

  async active(tenant) {
    if (typeof this.options.active === "function") {
      if (!(await this.options.active(tenant))) {
        this.log.debug("Replication cache not enabled for tenant", {
          tenant,
        });
        return false;
      }
    }
    return true;
  }

  search(query) {
    let search = true;
    if (query.SELECT.search?.length > 0) {
      const ref = query._target.name;
      this.stats.search[ref] ??= 0;
      this.stats.search[ref]++;
      this.log.debug("Replication cache skipped for search", {
        ref,
      });
      search = false;
    }
    return search;
  }

  localized(query, refs) {
    let localized = true;
    if (query.SELECT.localized) {
      const ref = query._target.name;
      this.stats.localized[ref] ??= 0;
      this.stats.localized[ref]++;
      this.log.debug("Replication cache not enabled for 'localized' without deploy feature", {
        ref,
      });
      localized = false;
    } else {
      for (const ref of refs) {
        if (ref.startsWith("localized.")) {
          this.stats.localized[ref] ??= 0;
          this.stats.localized[ref]++;
          this.log.debug("Replication cache not enabled for 'localized' without deploy feature", {
            ref,
          });
          localized = false;
        }
      }
    }
    return localized;
  }

  projections(model, refs) {
    let projections = true;
    for (const ref of refs) {
      const definition = model.definitions[ref];
      if (definition.query) {
        this.stats.projections[ref] ??= 0;
        this.stats.projections[ref]++;
        this.log.debug("Replication cache not enabled for 'projections' without deploy feature", {
          ref,
        });
        projections = false;
      }
    }
    return projections;
  }

  async logStats() {
    this.log.info("Replication cache statistics", this.stats);
    this.log.info("Replication cache size", await this.size());
  }
}

class ReplicationCacheTenant {
  constructor(tenant, model, options) {
    this.id = tenant;
    this.model = model;
    this.options = options;
    this.csn = model.definitions;
    this.cache = new Map();
  }

  async prepare() {
    this.db = await createDB(this.id, this.model, this.options);
    return this;
  }
}

class ReplicationCacheEntry {
  constructor(cache, tenant, ref) {
    this.cache = cache;
    this.service = cache.service;
    this.tenant = tenant;
    this.csn = tenant.csn;
    this.db = tenant.db;
    this.ref = ref;
    this.definition = this.csn[ref];
    this.preload = this.cache.options.preload && this.definition[Annotations.ReplicatePreload];
    this.name = this.definition.name.replace(/\./gi, "_");
    this.status = Status.New;
    this.failures = 0;
    this.touched = Date.now();
    this.timestamp = Date.now();
    this.timeout = null;
    this.ttl = this.definition[Annotations.ReplicateTTL] || this.cache.options.ttl;
    this.size = 0; // bytes
    this.preparing = null;
    this.prepared = null;
  }

  async prepare(thread) {
    if (!this.preparing) {
      this.prepared = this.preparing = (async () => {
        this.cache.log.debug("Preparing replication cache ref started", {
          tenant: this.tenant.id,
          ref: this.ref,
        });
        try {
          await this.cache.template;
          if ([Status.New].includes(this.status)) {
            await this.initialize();
          }
          if ([Status.Initialized, Status.Open, Status.Failed].includes(this.status)) {
            await this.load(thread);
            this.status = Status.Ready;
            this.failures = 0;
            this.timeout = setTimeout(async () => {
              this.cache.log.debug("Replication cache ref TTL reached", {
                tenant: this.tenant.id,
                ref: this.ref,
              });
              await this.clear(true);
            }, this.ttl).unref();
          }
          this.cache.log.debug("Preparing replication cache ref finished", {
            tenant: this.tenant.id,
            ref: this.ref,
          });
          if (this.cache.options.prune) {
            this.cache.prune(this.tenant.id).catch((err) => {
              this.cache.log.error("Pruning replication cache failed", err);
            });
          }
        } catch (err) {
          this.status = Status.Failed;
          this.failures++;
          if (this.failures > this.cache.options.retries) {
            this.status = Status.Invalid;
          }
          throw err;
        }
        this.preparing = null;
      })();
    }
    return this.preparing;
  }

  async initialize() {
    if (!this.cache.options.deploy) {
      const csn = {
        definitions: {
          [this.definition.name]: {
            name: this.definition.name,
            kind: "entity",
            elements: Object.keys(this.definition.elements).reduce((result, name) => {
              const element = this.definition.elements[name];
              if (element.type !== "cds.Association" && element.type !== "cds.Composition") {
                result[name] = element;
              }
              return result;
            }, {}),
          },
        },
      };
      const ddl = cds.compile(csn).to.sql({ dialect: "sqlite" })?.[0]?.replace(/\n/g, "");
      this.name = /CREATE (TABLE|VIEW) ([^ ]*?) /.exec(ddl)?.[2];
      await this.db.tx(async (tx) => {
        let result = await tx.run("SELECT name FROM sqlite_schema WHERE type = 'table' and name = ?", [this.name]);
        if (result.length === 0) {
          await tx.run(ddl);
        }
      });
    }
    this.status = Status.Initialized;
    this.timestamp = Date.now();
  }

  async load(thread) {
    this.timestamp = Date.now();
    await this.clear();
    if (thread && cds.context && this.service instanceof SQLiteService) {
      const srcTx = this.service.tx(cds.context);
      await this.db.tx({ tenant: this.tenant.id }, async (destTx) => {
        await this.loadChunked(srcTx, destTx);
        await this.checkRecords(srcTx, destTx);
        await this.calcSize(destTx);
      });
    } else {
      await this.service.tx({ tenant: this.tenant.id }, async (srcTx) => {
        await this.db.tx({ tenant: this.tenant.id }, async (destTx) => {
          await this.loadChunked(srcTx, destTx);
          await this.checkRecords(srcTx, destTx);
          await this.calcSize(destTx);
        });
      });
    }
    this.timestamp = Date.now();
  }

  async loadChunked(srcTx, destTx) {
    const keys = Object.keys(this.definition.keys);
    const selectQuery = SELECT.from(this.definition).orderBy(keys);
    selectQuery.replication = true;
    const chunkSize = this.cache.options.chunks;
    let offset = 0;
    let entries = [];
    do {
      entries = await srcTx.run(selectQuery.limit(chunkSize, offset));
      if (entries.length > 0) {
        const insertQuery = INSERT.into(this.definition).entries(entries);
        const result = await destTx.run(insertQuery);
        if (this.cache.options.validate) {
          if (isNaN(Number(result)) || isNaN(entries?.length) || Number(result) !== entries.length) {
            this.cache.log.debug("Loading replication cache failed. Number of inserted entries does not match.", {
              ref: this.ref,
              entries: entries.length,
              result: result.valueOf(),
            });
            throw new Error("Loading replication cache failed. Number of inserted entries does not match.");
          }
        }
        offset += chunkSize;
      }
    } while (entries.length > 0);
  }

  async checkRecords(srcTx, destTx) {
    if (this.cache.options.validate) {
      const countQuery = SELECT.one.from(this.definition).columns("count(*) as count");
      countQuery.replication = true;
      const srcCount = (await srcTx.run(countQuery))?.count;
      const destCount = (await destTx.run(countQuery))?.count;
      if (isNaN(srcCount) || isNaN(destCount) || srcCount !== destCount) {
        this.cache.log.debug("Loading replication cache failed. Number of inserted entries does not match.", {
          ref: this.ref,
          entries: srcCount,
          result: destCount,
        });
        throw new Error("Loading replication cache failed. Number of inserted entries does not match.");
      }
    }
  }

  async calcSize(tx) {
    const result = await tx.run("select sum(pgsize) as bytes from dbstat where name = ?", [this.name]);
    const bytes = result[0]?.bytes;
    this.size = bytes <= 4096 ? 0 : bytes;
  }

  async clear(ttl) {
    this.status = Status.Open;
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    await this.db.tx(async (tx) => {
      await tx.run("DELETE from " + this.name);
      this.size = this.calcSize(tx);
    });
    this.timestamp = Date.now();
    if (ttl && this.preload) {
      this.cache.preloadAnnotated(this.tenant.id, this.cache.model, [this.ref]);
    }
  }
}

module.exports = ReplicationCache;

async function createDB(tenant, model, options) {
  const filePath = await dbPath(tenant, options);
  cds.log(Component).debug("Preparing replication cache database", {
    tenant,
    file: filePath,
  });
  if (options.deploy && filePath !== Constants.InMemory && tenant !== Tenant.Template) {
    const templateDatabase = await dbPath(Tenant.Template, options);
    await fs.copyFile(templateDatabase, filePath);
  }
  const db = new SQLiteService(tenant ?? Tenant.Default, model, {
    kind: "sqlite",
    impl: "@cap-js/sqlite",
    credentials: { ...options.credentials, database: filePath },
  });
  await db.init();
  if (options.deploy && (filePath === Constants.InMemory || tenant === Tenant.Template)) {
    await db.tx(async () => {
      await cds.deploy(filePath === Constants.InMemory ? "*" : model, undefined, []).to(db);
    });
    if (tenant === Tenant.Template) {
      await db.disconnect(); // Close to finalize template file before copying
    }
  }
  return db;
}

async function dbPath(tenant, options) {
  let filePath = options.credentials?.database ?? Constants.InMemory;
  if (filePath !== Constants.InMemory) {
    const dir = path.join(
      options.tmpDir ? options.tmpDirPath : process.cwd(),
      options.baseDir ?? "",
      options.name ?? "",
      options.group ?? "",
    );
    await fs.mkdir(dir, { recursive: true });
    if (tenant) {
      const parts = filePath.split(".");
      const extension = parts.pop();
      filePath = path.join(dir, `${parts.join(".")}-${tenant}.${extension}`);
    } else {
      filePath = path.join(dir, filePath);
    }
  }
  return filePath;
}

function baseRefs(model, refs) {
  const baseRefs = [];
  let currentRefs = refs;
  let nextRefs = [];
  while (currentRefs.length > 0) {
    for (const ref of currentRefs) {
      const definition = model.definitions[ref];
      if (!definition.query) {
        baseRefs.push(ref);
      } else {
        nextRefs = nextRefs.concat(queryRefs(model, definition.query));
      }
    }
    currentRefs = nextRefs;
    nextRefs = [];
  }
  return unique(baseRefs);
}

function localizedRefs(model, query, refs) {
  if (!query.SELECT.localized) {
    return refs;
  }
  const localizedRefs = [];
  for (const ref of refs) {
    if (model.definitions[`${ref}.texts`]) {
      localizedRefs.push(`${ref}.texts`);
    }
  }
  return unique(refs.concat(localizedRefs));
}

function queryRefs(model, query) {
  if (!query.SELECT) {
    return [];
  }
  return unique(fromRefs(model, query));
}

function fromRefs(model, query) {
  let refs = [];
  if (query.SELECT.from.SELECT) {
    refs = fromRefs(model, query.SELECT.from);
  } else if (query.SELECT.from.ref) {
    refs = resolveRefs(model, query.SELECT.from.ref);
  } else if ((query.SELECT.from.join || query.SELECT.from.SET) && query.SELECT.from.args) {
    refs = query.SELECT.from.args.reduce((refs, arg) => {
      refs = refs.concat(resolveRefs(model, arg.ref || arg));
      return refs;
    }, []);
  }
  if (query._target) {
    const target = model.definitions[query._target.name];
    if (query.SELECT.orderBy) {
      refs = refs.concat(expressionRefs(model, target, query.SELECT.orderBy));
    }
    if (query.SELECT.columns) {
      refs = refs.concat(expressionRefs(model, target, query.SELECT.columns));
      refs = refs.concat(expandRefs(model, target, query.SELECT.columns));
    }
    if (query.SELECT.where) {
      refs = refs.concat(expressionRefs(model, target, query.SELECT.where));
    }
    if (query.SELECT.having) {
      refs = refs.concat(expressionRefs(model, target, query.SELECT.having));
    }
  }
  return refs;
}

function resolveRefs(model, refs) {
  let resolvedRefs = [];
  let ref = refs[0];
  if (ref.id) {
    if (ref.where) {
      const definition = model.definitions[ref.id];
      resolvedRefs = resolvedRefs.concat(expressionRefs(model, definition, ref.where));
    }
    ref = ref.id;
  }
  resolvedRefs.push(ref);
  let current = model.definitions[ref];
  for (const ref of refs.slice(1)) {
    if (current.elements[ref].type === "cds.Association" || current.elements[ref].type === "cds.Composition") {
      current = current.elements[ref]._target;
      resolvedRefs.push(current.name);
    }
  }
  return resolvedRefs;
}

function identifierRefs(model, definition, array) {
  let refs = [];
  for (const entry of array) {
    if (Array.isArray(entry.ref)) {
      let current = definition;
      for (const ref of entry.ref) {
        if (current.elements[ref].type === "cds.Association" || current.elements[ref].type === "cds.Composition") {
          current = current.elements[ref]._target;
          refs.push(current.name);
        }
      }
    }
  }
  return refs;
}

function expressionRefs(model, definition, array) {
  let refs = identifierRefs(model, definition, array);
  for (const entry of array) {
    if (entry.xpr) {
      refs = refs.concat(expressionRefs(model, definition, entry.xpr));
    } else if (entry.args) {
      refs = refs.concat(expressionRefs(model, definition, entry.args));
    } else if (entry.SELECT) {
      refs = refs.concat(fromRefs(model, entry));
    }
  }
  return refs;
}

function expandRefs(model, definition, columns) {
  let refs = [];
  for (const column of columns) {
    if (Array.isArray(column.ref) && column.expand) {
      let current = definition;
      for (const ref of column.ref) {
        current = current.elements[ref]._target;
        refs.push(current.name);
      }
      refs = refs.concat(expandRefs(model, current, column.expand));
    }
  }
  return refs;
}

function cached(cache, field, init) {
  try {
    if (init && !cache.get(field)) {
      cache.set(field, init());
    }
    const result = cache.get(field);
    (async () => {
      try {
        cache.set(field, await result);
      } catch {
        cache.delete(field);
      }
    })();
    return cache.get(field);
  } catch (err) {
    cache.delete(field);
    throw err;
  }
}

function unique(array) {
  return [...new Set(array)].sort();
}
