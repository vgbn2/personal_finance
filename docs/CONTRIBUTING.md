# Contributing

This project is meant for several contributors. Keep changes understandable, bounded, and aligned with the active phase.

## Before Coding

Read:

- `docs/README.md`
- `docs/QUICKSTART.md`
- `docs/spec.md`
- `docs/engineering.md`

Then identify which phase your change belongs to. If the phase is not active, discuss the change before implementing it.

## Active Phase Rules

Phase 1 is active.

Allowed by default:

- trading-platform scaffold file names
- docs and module ownership maps
- config placeholder updates
- model metadata placeholders
- small sample-data fixtures for tests
- config sample updates
- documentation improvements

Avoid by default:

- live web dashboard behavior
- broker execution
- real market ingestion
- ML inference
- deployment automation
- new external dependencies

## Code Standards

- Use C++20.
- Prefer standard-library code where practical.
- Keep public declarations in `cpp_core/include`.
- Keep implementations in the owning module under `cpp_core/src`.
- Keep tests in `cpp_core/test`.
- Write simple code before adding abstractions.
- Validate inputs close to the module that owns the behavior.

## Documentation Standards

Update docs in the same change when you alter:

- public API
- config fields
- build commands
- runtime commands
- dependencies
- phase boundaries
- repository layout

Use the right document:

- `README.md` in `docs`: orientation
- `QUICKSTART.md`: build and run commands
- `spec.md`: product behavior and phase scope
- `engineering.md`: architecture and code boundaries
- `operations.md`: verification and troubleshooting
- `DEPLOYMENT.md`: future deployment plan
- `web_api.md`: future web/API plan

## Test Expectations

Every behavior change needs a test or a clear reason why a test is not useful yet.

Required Phase 1 baseline:

```text
scaffold docs identify planned behavior without claiming it is implemented
```

## Review Checklist

Before asking for review:

- build passes
- tests pass
- docs are updated
- no generated files are included
- no live future-phase behavior is mixed into Phase 1 scaffold changes
- any new dependency is documented and justified
