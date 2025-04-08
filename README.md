# CAP Node.js Community Common

## Getting Started

- Run `npm add @cap-js-community/common` in `@sap/cds` project

## About this Project

This project provides common functionality for CDS services to be consumed with [SAP Cloud Application Programming Model (Node.js)](https://www.npmjs.com/package/@sap/cds).

## Table of Contents

- [Replication Cache](#replication-cache)
- [Migration Check](#migration-check)
- [Rate Limiting](#rate-limiting)
- [Redis Client](#redis-client)
- [Support, Feedback, Contributing](#support-feedback-contributing)
- [Code of Conduct](#code-of-conduct)
- [Licensing](#licensing)

## Replication Cache

The replication cache allows to cache a service (e.g. db service) into a tenant-aware SQLite database.
Local replicated SQLite database can be queried with same query as the original service.

### Usage

```cds
@cds.replicate
entity Books {
  key ID       : Integer;
      title    : localized String;
      descr    : localized String;
}
```

### Annotations

Annotations can be used to enable replication cache for a service:

- `@cds.replicate: Boolean | Object`: Enable replication cache for entity
  - `@cds.replicate.ttl: Number`: Time-To-Live (TTL) of cache entry in milliseconds
  - `@cds.replicate.auto: Boolean`: Replication is managed automatically
  - `@cds.replicate.preload: Boolean`: Preload replication for entity
  - `@cds.replicate.group: String`: Replication group name

Defaults are taken from CDS environment.

### Options

Options can be passed to replication cache via CDS environment via `cds.replicationCache` section:

- `plugin: Boolean`: Replication cache is activated via CDS plugin for `db` service. Default is `true`
- `name: String`: Service name. Default is `"db"`
- `group: String`: Replication group name. Default is `"default"`
- `credentials: Object`: SQLite credentials
  - `database: String`: Database file. Default is `":memory:"` and in production: `"data.sqlite"`
- `ttl: Number`: Time-To-Live (TTL) of cache entries in milliseconds. Default is `1800000` (30 minutes)
- `check: Number`: Interval to check size and prune. Default is `60000` (1 minute)
- `stats: Number`: Interval to log statistics. Default is `300000` (5 minutes)
- `size: Number`: Maximal cache size in bytes. Default is `10485760` (10 MB) and in production: `104857600` (100 MB)
- `chunks: Number`: Replication chunk size. Default is `1000`
- `retries: Number`: Replication retries for failed replications. Default is `3`
- `auto: Boolean`: Replication is managed automatically. Default is `true`
- `prune: Boolean`: Check and prune directly after replication. Default is `true`
- `validate: Boolean`: Validate count of replicated records. Default is `true`
- `deploy: Boolean`: Deploy whole schema to allow queries on projections. Default is `true`
- `preload: Boolean`: Preload all replication enables entity. Default is `false`
- `wait: Boolean`: Delay read query until replication finished. Default is `false`
- `search: Boolean`: Search queries are allowed on replication cache. Default is `true`
- `measure: Boolean`: Measure and compare replication cache and service query execution. Default is `false`
- `tmpDir: Boolean`: Store replication cache file in temporary directory. Default is `false`
- `baseDir: String`: Base directory for replication cache files. Default is `"temp"`

## Migration Check

### Options

Options can be passed to migration check via CDS environment via `cds.migrationCheck` section:

- `baseDir: String`: Specifies the base directory for migration check. Default is `"migration-check"`
- `whitelist: Boolean`: Requires to maintain a whitelist for compatible changes. Default is `true`
- `checkMtx: Boolean`: Includes CDS MTXS persistence into check. Default is `true`
- `keep: Boolean`: Keeps whitelist after update, otherwise whitelist is cleared. Default is `false`
- `freeze: Boolean`: Freeze the persistence. Event compatible changes are not allowed, Default is `false`
- `label: String`: Label to describe the updated hash files in addition to the timestamp. Default is `""`
- `buildPath: String`: Path to the build CSN. If not specified it derived from CAP project type. Default is `null`
- `adminHash: String`: Specify admin hash to acknowledge incompatible changes. Default is `null`

### Usage

#### Basic Flow

- Build CSN: `cds build --production`
- Check migrations: `cdsmc`
- Update Production CSN: `cdsmc -u`

### Whitelisting

- Maintain the whitelist extension file `migration-extension-whitelist.json` for compatible changes:
  - **Whitelist Entity**:
  ```json
  {
    "definitions": {
      "test.Test": {}
    }
  }
  ```
  - **Whitelist Entity Element**:
  ```json
  {
    "definitions": {
      "test.Test": {
        "elements": {
          "value": {}
        }
      }
    }
  }
  ```

### Admin Mode

- Get Admin Hash: `cdsmc -a`
- (Un-)Freeze Persistence (based on options): `cdsmc -u -a`

### Pipeline

- Build & Check: `cds build --production && cdsmc`
- Update Production CSN: `cdsmc -u`

> Production CSN MUST be added to version control

## Rate Limiting

### Usage

```cds
@cds.rateLimit
service BookshopService {
  entity Books @readonly   as projection on test.Books;
}
```

### Annotations

- `@cds.rateLimt: Boolean`: Activate rate limit for service
- `@cds.rateLimt.maxConcurrent: Number`: Maximum number of concurrent requests per service and tenant
- `@cds.rateLimt.maxInWindow: Number`: Maximum number of requests in defined window per service and tenant
- `@cds.rateLimt.window: Number`: Window length in milliseconds

### Options

Options can be passed to migration check via CDS environment via `cds.rateLimiting` section:

- `plugin: Boolean`: Rate limiting is activated via CDS plugin for annotated services. Default is `true`
- `maxConcurrent: Boolean`: Maximum number of concurrent requests per service and tenant. Default is `3`
- `maxWindow: Boolean`: Maximum number of requests in defined window per service and tenant. Default is `10000` (10 seconds)
- `window: Boolean`: Window length in milliseconds. Default is `3600000` (1 hour)
- `retry: Boolean`: Default is `5`

### Redis

Redis options can be provided in CDS env as follows:

```json
{
  "cds": {
    "requires": {
      "redis-rateLimiting": {
        "vcap": {
          "tag": "my-redis"
        },
        "options": {}
      }
    }
  }
}
```

For shared redis configuration Redis service name can be provided in CDS env as follows:

```json
{
  "cds": {
    "requires": {
      "redis-rateLimiting": false,
      "redis": {
        "vcap": {
          "tag": "my-redis"
        },
        "options": {}
      }
    }
  }
}
```

## Redis Client

A Redis Client broker is provided to connect to Redis service.

### Usage

#### Main default singleton

```js
const { RedisClient } = require("@cap-js-community/common");
const mainClient = await RedisClient.default().createMainClientAndConnect(options);
```

#### Main named singleton

```js
const { RedisClient } = require("@cap-js-community/common");
const mainClient = await RedisClient.default("name").createMainClientAndConnect(options);
```

#### Custom named

```js
const { RedisClient } = require("@cap-js-community/common");
const client = await new RedisClient(name).createClientAndConnect(options);
```

### Options

Options can be passed to Redis client via CDS environment via `cds.redis` section:
Redis options can be provided in CDS env as follows:

```json
{
  "cds": {
    "requires": {
      "redis": {
        "vcap": {
          "tag": "redis-cache"
        },
        "options": {}
      }
    }
  }
}
```

In addition, options can be passed to Redis client during creation via `options` parameter:

```js
const { RedisClient } = require("@cap-js-community/common");
const mainClient = await RedisClient.default().createMainClientAndConnect(options);
```

For details on Redis `createClient` configuration options see [Redis Client Configuration](https://github.com/redis/node-redis/blob/master/docs/client-configuration.md).

## Support, Feedback, Contributing

This project is open to feature requests/suggestions, bug reports etc. via [GitHub issues](https://github.com/cap-js-community/common/issues). Contribution and feedback are encouraged and always welcome. For more information about how to contribute, the project structure, as well as additional contribution information, see our [Contribution Guidelines](CONTRIBUTING.md).

## Code of Conduct

We as members, contributors, and leaders pledge to make participation in our community a harassment-free experience for everyone. By participating in this project, you agree to abide by its [Code of Conduct](CODE_OF_CONDUCT.md) at all times.

## Licensing

Copyright 2025 SAP SE or an SAP affiliate company and sap-afc-sdk contributors. Please see our [LICENSE](LICENSE) for copyright and license information. Detailed information including third-party components and their licensing/copyright information is available [via the REUSE tool](https://api.reuse.software/info/github.com/cap-js-community/common).
