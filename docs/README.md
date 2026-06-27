# Documentation

Contributor-facing docs for Sovereign — a phased C++20 quantitative trading
platform (market data, research, CNN-assisted signals, portfolio/risk
monitoring, controlled execution). Active phase: **Phase 1 — Trading Platform
Scaffold.**

## The docs

- **`SPECIFICATION.md`** — the single source of truth: current state, scope,
  data/CNN/research/execution contracts, tech stack, and the phase roadmap. Read
  this to understand *what the system is*.
- **`ARCHITECTURE.md`** — system shape: core engine, the two I/O boundaries, and
  the thin CLI/web interfaces. Read this to understand *how it fits together*.
- **`QUICKSTART.md`** — build, test, and run the current scaffold.
- **`operations.md`** — local dev loop, verification, troubleshooting, release
  hygiene.
- **`CONTRIBUTING.md`** — rules for changes, reviews, docs, and dependencies.

## How to read them

Start with `SPECIFICATION.md`, then `QUICKSTART.md` to build and run. If a
feature is marked planned/future in the spec, do not write code against it as if
it exists — it becomes a target only when its phase is opened.
