# Deployment Plan

Deployment is not active in Phase 1. This document exists so contributors understand the intended future direction without adding deployment requirements to the current skeleton.

## Current Status

Phase 1 is local-only.

Current runtime:

- local scaffold and docs
- optional legacy local executable
- optional local config placeholders
- no network access
- no database
- no secrets
- no deployment target

## Future Deployment Goals

Later phases may need:

- reproducible release builds
- Docker images
- CI build and test jobs
- artifact publishing
- environment-specific config
- secrets handling
- monitoring and operational logs

## Deployment Phases

Phase 1:

- no deployment
- local build only

Phase 2:

- local asset contracts and calculations
- no live external systems

Phase 3:

- research, backtest, and CNN feature artifacts
- no live external systems

Phase 4:

- market data adapters may require API configuration
- local cache may require storage setup

Phase 5:

- web dashboard
- broker connectivity
- dry-run and live modes
- Docker packaging
- CI/CD
- production monitoring

## Future Production Requirements

Before any live execution deployment, the project must have:

- dry-run mode
- explicit live flag
- confirmation gate
- credential storage policy
- audit logs
- kill switch behavior
- connection failure behavior
- rollback procedure

## Docker Status

Docker is planned, not required.

Do not make Docker a Phase 1 dependency. If Docker files exist in the repository, treat them as placeholders until deployment work is active.

## Secrets Policy

Phase 1 should not need secrets.

Future phases must never hardcode credentials. Credentials should come from an approved secret source such as environment variables, a local encrypted store, or a deployment secret manager.
