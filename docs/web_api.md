# Web And API Plan

The web dashboard and API are planned future systems. They are not part of Phase 1.

## Current Status

There is no active web server in Phase 1.

Current interaction model:

```text
contributor -> scaffold docs/configs/file names -> future CLI/core/web modules
```

## Future Purpose

The web surface should make system state easier to inspect. It should not become the owner of financial logic.

Expected future responsibilities:

- display simulation results
- display risk metrics
- display backtest results
- display portfolio state
- display signals and data quality reports
- manage non-dangerous settings
- submit dry-run jobs

Expected non-responsibilities:

- owning core calculations
- bypassing CLI or core validation
- storing raw secrets in browser code
- triggering live execution without explicit server-side gates

## Future Architecture

Planned shape:

```text
browser UI
    |
    v
web server or local API
    |
    v
CLI/core adapter
    |
    v
sovereign_core
```

## Future Message Types

These are placeholders, not active contracts.

Simulation request:
Legacy wealth examples may remain for reference, but future message contracts should target assets, signals, backtests, portfolio state, and execution.

```json
{
  "type": "SIMULATION_REQUEST",
  "params": {
    "initInv": 1000.0,
    "years": 20,
    "ret": 12.0
  }
}
```

Simulation response:

```json
{
  "type": "SIMULATION_RESULT",
  "data": {
    "finalNetWorth": 9646.293093274,
    "months": 240
  }
}
```

Future system status:

```json
{
  "type": "STATUS",
  "data": {
    "phase": "local",
    "mode": "dry-run",
    "healthy": true
  }
}
```

## Activation Criteria

The web/API layer should not be implemented until:

- the C++ core has stable inputs and outputs
- config schema is documented
- tests exist for the core behavior being displayed
- the team agrees on whether the web layer is local-only or deployable
