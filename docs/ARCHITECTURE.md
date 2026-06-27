# Architecture

How Sovereign is structured. Scope, contracts, and the phase roadmap live in
`SPECIFICATION.md`; this doc covers only the shape of the system. Section
references below (e.g. §9) point to `SPECIFICATION.md`.

## The model in one line

**One core engine bracketed by two I/O boundaries, with thin interfaces on top.**

Read it top-level as: data-provider APIs in → ingest → validate → compute →
output; orders out through a separate gated boundary; CLI and web merely trigger
the core and render its output. They are not the core.

```text
        ┌─────────────── INBOUND BOUNDARY ───────────────┐
        │   external data-provider APIs                   │
        │   (equity / index / fx / crypto / macro / news) │
        └───────────────────────┬─────────────────────────┘
                                 ▼
  ╔══════════════════════ CORE ENGINE (cpp_core) ══════════════════════╗
  ║  ingestion ─► validate (data-quality gates) ─► validated data      ║
  ║                                  │                                  ║
  ║          ┌───────────────────────┴───────────────────────┐         ║
  ║          ▼                                                ▼         ║
  ║  features ─► CNN tensors ─► inference ─► signals   backtests /      ║
  ║                                                    research /       ║
  ║                                                    cost model       ║
  ║          └───────────────┬───────────────────────────────┘         ║
  ║                          ▼                                          ║
  ║  strategy decision ─► pre-trade risk gates ─► portfolio state /     ║
  ║                                               PnL / exposure        ║
  ╚════════════╤══════════════════════════════════════════╤════════════╝
               ▼ (orders, only if trading)                 ▼ (reads)
   ┌─── OUTBOUND BOUNDARY ───┐              ┌──── INTERFACES (thin) ────┐
   │  broker / exchange APIs │              │  CLI (cli/)               │
   │  (paper or live)        │              │  Web dashboard/API (web/) │
   └─────────────────────────┘              └───────────────────────────┘
```

## Tier 1 — I/O boundaries

The only parts that talk to the outside world, and the only place external
failure/latency lives.

- **Inbound:** ingestion adapters call data-provider APIs and hand raw events to
  the core. They translate, they do not calculate.
- **Outbound:** broker adapters (`cli/src/broker_api/*`, `execution/*_broker*`)
  translate internal orders into broker API calls. Symmetric to ingestion —
  ingestion pulls data *in*, execution pushes orders *out*. Live execution stays
  behind explicit gates (see §9); no signal reaches this boundary directly.

## Tier 2 — Core engine (`cpp_core/`)

The product. Ingest → validate → compute (features, models, backtests, research,
risk) → output (signals, marks, portfolio state, reports). It owns all financial
logic and has no idea whether a human, a CLI, or a web page triggered a run.

- Public declarations in `cpp_core/include`.
- Implementations under the owning module in `cpp_core/src` (module ownership: §5).
- Tests in `cpp_core/test`.

## Tier 3 — Interfaces (`cli/`, `web/`)

Thin and interchangeable. They trigger the core and render its output; delete
both and the platform is unchanged, you just lose the buttons. They own **no**
financial logic, must not bypass core validation, and must not reach the
outbound boundary except through the core's gates. Web is read/inspect-only and
not active in Phase 1.

## Supporting inputs (not tiers)

- **Config** (`config/`) — sources, feature windows, strategy params, risk
  limits, regime routing, alerts, app mode. Parameters into the core. No
  credentials.
- **Models** (`models/`) — CNN and regime artifacts + metadata, loaded by the
  core's inference stage.

## Conventions

- Empty/comment-only files are intentional scaffold placeholders.
- New modules reuse existing folder names; no parallel structures.
- One public API → one authoritative declaration. No duplicate headers.
- Validate inputs close to the module that owns the behavior.
