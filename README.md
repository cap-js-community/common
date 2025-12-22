# CAP Node.js Community Common

[![npm version](https://img.shields.io/npm/v/@cap-js-community/common)](https://www.npmjs.com/package/@cap-js-community/common)
[![monthly downloads](https://img.shields.io/npm/dm/@cap-js-community/common)](https://www.npmjs.com/package/@cap-js-community/common)
[![REUSE status](https://api.reuse.software/badge/github.com/cap-js-community/common)](https://api.reuse.software/info/github.com/cap-js-community/common)
[![Main CI](https://github.com/cap-js-community/common/actions/workflows/main-ci.yml/badge.svg)](https://github.com/cap-js-community/common/commits/main)

## Getting Started

- Run `npm add @cap-js-community/common` in `@sap/cds` project

## About this Project

This project provides common functionality for CDS services to be consumed with [SAP Cloud Application Programming Model (Node.js)](https://www.npmjs.com/package/@sap/cds).

## Table of Contents

- [Replication Cache](#replication-cache)
- [Migration Check](#migration-check)
- [Rate Limiting](#rate-limiting)
- [Redis Client](#redis-client)
- [Local HTML5 Repository](#local-html5-repository)
- [Support, Feedback, Contributing](#support-feedback-contributing)
- [Code of Conduct](#code-of-conduct)
- [Licensing](#licensing)

## Replication Cache

The replication cache allows to cache a service (e.g. db service) into a tenant-aware SQLite database.
Local replicated SQLite database can be queried with same query as the original service.

### Usage

> Replication cache uses SQLite as local database for productive usage.
> Ensure `@cap-js/sqlite` is installed as dependency (not as dev dependency) in your project.

```cds
@cds.replicate
entity Books {
  key ID       : Integer;
      title    : localized String;
      descr    : localized String;
}
```

### Annotations

Annotations can be used to enable replication cache for a service on entity level:

- `@cds.replicate: Boolean | Object`: Enable replication cache for entity
  - `@cds.replicate.ttl: Number`: Time-To-Live (TTL) of cache entry in milliseconds
  - `@cds.replicate.auto: Boolean`: Replication is managed automatically
  - `@cds.replicate.preload: Boolean`: Preload replication for entity
  - `@cds.replicate.group: String`: Replication group name
  - `@cds.replicate.static: Boolean`: Statically replicate non-tenant aware

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
- `pipe: Boolean`: Replication is streamed through pipeline. `chunks` is not used. Default is `true`
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

### Test

Replication cache is inactive per default for tests (`test` profile). It can be enabled via CDS env:

```json
{
  "cds": {
    "replicationCache": {
      "[test]": {
        "plugin": true
      }
    }
  }
}
```

## Migration Check

The migration check allows to check for incompatible changes in the CDS model and
to maintain a whitelist for compatible changes via `cdsmc` command line tool.

### Options

Options can be passed to migration check via CDS environment via `cds.migrationCheck` section:

- `baseDir: String`: Specifies the base directory for migration check. Default is `"migration-check"`
- `whitelist: Boolean`: Requires maintaining a whitelist for compatible changes. Default is `true`
- `checkMtx: Boolean`: Includes CDS MTXS persistence in check. Default is `true`
- `keep: Boolean`: Keeps whitelist after update, otherwise whitelist is cleared. Default is `false`
- `freeze: Boolean`: Freeze the persistence. Event compatible changes are not allowed, Default is `false`
- `label: String`: Label to describe the updated hash files in addition to the timestamp. Default is `""`
- `buildPath: String`: Path to the build CSN. If not specified, it is derived from the CAP project type. Default is `null`
- `adminHash: String`: Specify admin hash to acknowledge incompatible changes. Default is `null`
- `adminTracking: Boolean`: Track changes acknowledged by admin in an admin changes file. Default is `true`

### Usage

#### Build Production CSN

Production CSN is built for first time when not existing (otherwise it is updated):

- Build CSN: `cds build --production`
- Update Production CSN: `cdsmc -u`

> Production CSN MUST be added to version control.

#### Migration Check

Migration check is used to check for incompatible changes in a repetitive way along development:

- Build CSN: `cds build --production`
- Check Changes: `cdsmc`

Incompatible changes are detected and reported as error.
Compatible changes need to be whitelisted (can be disabled via options).

##### Checks

**Incompatible Changes:**

- A released entity cannot be removed (`ReleasedEntityCannotBeRemoved`)
- The draft enablement state of a released entity cannot be changed (`ReleasedEntityDraftEnablementCannotBeChanged`)
- A released element cannot be removed (`ReleasedElementCannotBeRemoved`)
- The key of a released element cannot be changed (`ReleasedElementKeyCannotBeChanged`)
- The managed/unmanaged state of a released element cannot be changed (`ReleasedElementManagedUnmanagedCannotBeChanged`)
- The virtual state of a released element cannot be changed (`ReleasedElementVirtualCannotBeChanged`)
- The localization state of a released element cannot be changed (`ReleasedElementLocalizationCannotBeChanged`)
- A released element cannot be changed to not-nullable (`ReleasedElementNullableCannotBeChanged`)
- The data type of a released element cannot be changed (`ReleasedElementTypeCannotBeChanged`)
- The data type of a released element cannot be shortened (`ReleasedElementTypeCannotBeShortened`)
- The scale or precision of a released element cannot be reduced (`ReleasedElementScalePrecisionCannotBeLower`)
- The target of a released element cannot be changed (`ReleasedElementTargetCannotBeChanged`)
- The cardinality of a released element cannot be changed (`ReleasedElementCardinalityCannotBeChanged`)
- The ON condition of a released element cannot be changed (`ReleasedElementOnConditionCannotBeChanged`)
- The keys condition of a released element cannot be changed (`ReleasedElementKeysConditionCannotBeChanged`)
- Enabling journal mode and changing entity in same cycle is not allowed (`ReleasedEntityJournalModeAndEntityChangeIsNotAllowed`)
- Changes to the index of a released entity are not allowed (`ReleasedEntityIndexChangeIsNotAllowed`)

**Compatible Changes:**

- Changes to the index of a released entity must be whitelisted (`ReleasedEntityIndexChangeIsNotWhitelisted`)
- Extending the type of a released element requires whitelisting (`ReleasedElementTypeExtensionIsNotWhitelisted`)
- Extending the scale or precision of a released element requires whitelisting (`ReleasedElementScalePrecisionExtensionIsNotWhitelisted`)
- Changing the type of a released element to a compatible type requires whitelisting (`ReleasedElementTypeChangeIsNotWhitelisted`)
- The new entity is not whitelisted (`NewEntityIsNotWhitelisted`)
- The new entity element is not whitelisted (`NewEntityElementIsNotWhitelisted`)
- A new entity element must have a default value if it is not nullable (`NewEntityElementNotNullableDefault`)
- The new entity index is not whitelisted (`NewEntityIndexIsNotWhitelisted`)

#### Update Production CSN

The Production CSN can be updated when no migration check errors occur:

- Build CSN: `cds build --production`
- Update Production CSN: `cdsmc -u`

> Production CSN MUST be added to version control.

### Whitelisting

Maintain the whitelist extension file `migration-extension-whitelist.json` for compatible changes:

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

#### Incompatible Changes

Accepted incompatible changes can be acknowledged and will not be reported as error anymore:

- Get current admin hash for incompatible changes: `cdsmc -a`
- Set admin hash in env: `cds.migrationCheck.adminHash`

#### Freeze Persistence

CDS persistence can be (temporarily) frozen to prevent any changes (also compatible) to the persistence model:

- Activate/Deactivate persistence freeze in env `cds.migrationCheck.freeze`
- Freeze/Unfreeze Persistence: `cdsmc -u -a`
  - File `./csn-prod.freeze` is created to indicate that persistence is frozen

### Pipeline

Migration check can be used in a pipeline (e.g. part of Pull Request voter)
to ensure that incompatible changes are not introduced:

- Build & Check: `cds build --production && cdsmc`
- Update Production CSN: `cds build --production && cdsmc -u`

> Production CSN MUST be added to version control.

## Rate Limiting

The rate limiting allows to limit the number of requests per service and tenant.

### Usage

```cds
@cds.rateLimiting
service BookshopService {
  entity Books @readonly   as projection on test.Books;
}
```

### Annotations

- `@cds.rateLimiting: Boolean`: Activate rate limit for service
- `@cds.rateLimiting.maxConcurrent: Number`: Maximum number of concurrent requests per service and tenant
- `@cds.rateLimiting.maxInWindow: Number`: Maximum number of requests in defined window per service and tenant
- `@cds.rateLimiting.window: Number`: Window length in milliseconds

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

### Test

Rate limiting is inactive per default for tests (`test` profile). It can be enabled via CDS env:

```json
{
  "cds": {
    "rateLimiting": {
      "[test]": {
        "plugin": true
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
const mainClient = await RedisClient.create().createMainClientAndConnect(options);
```

#### Main named singleton

```js
const { RedisClient } = require("@cap-js-community/common");
const mainClient = await RedisClient.create("name").createMainClientAndConnect(options);
```

#### Custom named

```js
const { RedisClient } = require("@cap-js-community/common");
const client = await new RedisClient("name").createClientAndConnect(options);
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

Specific Redis options for a custom name can be established as follows:

```json
{
  "cds": {
    "requires": {
      "redis-customName": {
        "vcap": {
          "tag": "redis-cache"
        },
        "options": {}
      }
    }
  }
}
```

```js
const { RedisClient } = require("@cap-js-community/common");
const mainClient = await RedisClient.create("customName").createMainClientAndConnect(options);
```

In addition, options can be passed to Redis client during creation via `options` parameter:

```js
const { RedisClient } = require("@cap-js-community/common");
const mainClient = await RedisClient.create().createMainClientAndConnect(options);
```

For details on Redis `createClient` configuration options see [Redis Client Configuration](https://github.com/redis/node-redis/blob/master/docs/client-configuration.md).

## Local HTML5 Repository

Developing HTML5 apps against hybrid environments including Approuter component requires a local HTML5 repository to directly test the changes to UI5 applications without deployment to a remote HTML5 repository.

### Usage

- Create a `default-env.json` in `approuter` folder, including a valid HTML5 repository configuration from deployment environment:

```json
{
  "VCAP_SERVICES": {
    "html5-apps-repo": [
      {
        "credentials": {
          "uri": "https://html5-apps-repo-rt.cfapps.sap.hana.ondemand.com"
        }
      }
    ]
  }
}
```

- Call command: `local-html5-repo`

All apps and libraries located in `app` folder and containing an `ui5.yaml` are redirected to local HTML5 repository
served from local file system. All other requests are proxied to the remote HTML5 repository.

## Support, Feedback, Contributing

This project is open to feature requests/suggestions, bug reports etc. via [GitHub issues](https://github.com/cap-js-community/common/issues). Contribution and feedback are encouraged and always welcome. For more information about how to contribute, the project structure, as well as additional contribution information, see our [Contribution Guidelines](CONTRIBUTING.md).

## Code of Conduct

We as members, contributors, and leaders pledge to make participation in our community a harassment-free experience for everyone. By participating in this project, you agree to abide by its [Code of Conduct](CODE_OF_CONDUCT.md) at all times.

## Licensing

Copyright 2025 SAP SE or an SAP affiliate company and common contributors. Please see our [LICENSE](LICENSE) for copyright and license information. Detailed information including third-party components and their licensing/copyright information is available [via the REUSE tool](https://api.reuse.software/info/github.com/cap-js-community/common).
