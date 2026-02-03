# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## Version 0.3.5 - 2026-02-03

### Fixed

- Express 5 (with CDS 9.7)

### Added

- CDM Builder

## Version 0.3.4 - 2026-01-20

### Fixed

- Fix journal migration check for draft entities

## Version 0.3.3 - 2026-01-07

### Added

- Local HTML5 repository

### Fixed

- Fix rate limiting redis env

## Version 0.3.2 - 2025-11-05

### Fixed

- Rework redis client

## Version 0.3.1 - 2025-11-05

### Fixed

- Rework redis client

## Version 0.3.0 - 2025-11-03

### Fixed

- Refactor replication cache
- Change `@cap-js/sqlite` to dev dependency
- Replication cache requires `@cap-js/sqlite` as project dependency (no dev dependency)

## Version 0.2.8 - 2025-10-13

### Fixed

- Trusted publishing

## Version 0.2.7 - 2025-10-13

### Fixed

- Trusted publishing

## Version 0.2.6 - 2025-08-04

### Fixed

- Migration Check `ReleasedElementCompatibleTypeChangeIsNotWhitelisted` to allow compatible type changes
- Admin tracking writes an admin changes file to keep track of incompatible changes as well

## Version 0.2.5 - 2025-07-07

### Fixed

- Normalize newline character in hash calculation

## Version 0.2.4 - 2025-07-03

### Fixed

- Multi-tenancy fixes
- Improve reference detection
- Deactivate TTL for negative value and static entities

## Version 0.2.3 - 2025-07-01

### Fixed

- Improve reference detection

## Version 0.2.2 - 2025-06-26

### Fixed

- Improve reference detection for aliases

## Version 0.2.1 - 2025-06-26

### Fixed

- Improve reference detection
- Static non-tenant aware replication via `cds.replicate.static`

## Version 0.2.0 - 2025-06-03

### Fixed

- CDS 9 compatibility

## Version 0.1.7 - 2025-05-08

### Fixed

- Enabling journal mode and changing entity in same cycle is not allowed

## Version 0.1.6 - 2025-05-07

### Fixed

- Redis 4

## Version 0.1.5 - 2025-05-05

### Fixed

- Dependencies

## Version 0.1.4 - 2025-04-10

### Fixed

- Improvements

## Version 0.1.3 - 2025-04-10

### Fixed

- Redis client improvements

## Version 0.1.2 - 2025-04-09

### Fixed

- Improvements

## Version 0.1.1 - 2025-04-09

### Fixed

- Improvements

## Version 0.1.0 - 2025-04-09

### Added

- Internal release
