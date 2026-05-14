# Engineering Guide

This document explains the current architecture and the engineering rules contributors should follow.

## Architecture Summary

The repository is being organized as a trading-platform scaffold. The current useful artifact is the file and documentation structure for contributors, not a complete trading engine.

```text
data sources
        |
        v
ingestion adapters -> validated market frames -> features/CNN tensors
        |                                      |
        v                                      v
backtests and research                    signals
        |                                      |
        v                                      v
portfolio monitor <- trade log <- execution and broker adapters
```

The personal-finance code is legacy/reference context. New engineering work should prioritize trading data, research, execution, and monitoring modules.

## Active Source Map

- `cpp_core/src/parser`: planned parsing and market-data normalization
- `cpp_core/src/indicators`: planned technical indicators
- `cpp_core/src/backtest`: planned backtest engine and trade records
- `cpp_core/src/ml`: planned feature tensors and ONNX/CNN inference boundary
- `cpp_core/src/execution`: planned order and broker execution boundary
- `cpp_core/src/portfolio`: planned positions, PnL, and exposure monitoring
- `cli/src/commands`: planned CLI surfaces for data, signals, backtests, portfolio, and execution
- `web/server/routes`: planned API routes for dashboard surfaces
- `config/phase1_default.json`: sample configuration
- `docs/scaffold_manifest.md`: file-name manifest for contributor ownership

## Build Targets

The CMake project should define:

- `sovereign_core`: reusable C++ library
- `sovereign_wealth`: Phase 1 executable
- `phase1_compounding_test`: test executable
- `phase1_compounding`: CTest test name

The root `CMakeLists.txt` should delegate into `cpp_core`.

## Public API Rules

Public structs and functions used across modules belong in `cpp_core/include`.

Implementation details belong under the module that owns them:

- asset identity should go under `cpp_core/src/assets`
- data ingestion should go under `cpp_core/src/ingestion`
- validated market records should go under `cpp_core/src/data`
- feature engineering should go under `cpp_core/src/features`
- market logic should go under market-owned modules
- future macro logic should go under `cpp_core/src/macro`
- future data quality logic should go under `cpp_core/src/data_quality`
- future quant research workflow logic should go under `cpp_core/src/research`
- execution logic should go under `cpp_core/src/execution`
- portfolio monitoring should go under `cpp_core/src/portfolio`
- legacy wealth logic stays under `cpp_core/src/wealth`

Avoid multiple headers with the same name and different definitions. One public API should have one authoritative declaration.

## Legacy Wealth Data Model

This model is retained as legacy/reference context. New trading work should not add to it unless a field is explicitly reused as a macro, sentiment, or purchasing-power input.

`SimulationParams`:

- `initInv`
- `years`
- `wage` legacy; possible macro labor-market input only in future trading work
- `wageGrow` legacy; possible wage-growth or consumer-sentiment input only in future trading work
- `ret`
- `retSd`

`MonthResult`:

- `month`
- `netWorth`
- `portfolio`

## Legacy Numerical Behavior

The legacy wealth simulator converts annual return to monthly return with:

```text
monthlyReturn = (1 + annualReturn)^(1 / 12) - 1
```

This behavior should not drive the trading-platform module design.

## Dependency Policy

Phase 1 should use the C++ standard library only.

Before adding a dependency:

- confirm the active phase needs it
- update requirements documentation
- isolate it behind a small module boundary
- add tests around behavior that depends on it

## Testing Policy

Every behavior change should have a test. For Phase 1, the baseline test must remain stable unless the product spec changes.

Required baseline:

```text
1000M at 12% annual return for 20 years -> 9646.293093274M
```

## Deferred Engineering Notes

Later phases may introduce:

- JSON library
- SQLite
- HTTP/WebSocket client
- ONNX Runtime
- Node.js web dashboard
- Rust or expanded C++ CLI
- Docker deployment

These should not affect Phase 1 build or runtime until their phases are active.

Future module reservations:

- `cpp_core/src/macro`: FX, inflation, rates, yield curves, volatility indexes, liquidity and credit stress, macro regime classification, and economy health scoring.
- `cpp_core/src/data_quality`: missing data, stale data, timestamp mismatch, source freshness, and lookahead-risk checks for market and macro inputs.
- `cpp_core/src/research`: research hypotheses, backtest integrity rules, cost models, validation windows, portfolio constraints, and promotion gates.

Macro and research modules are not active in Phase 1. Macro data must not affect Phase 1 or Phase 2 builds. Phase 2 may port the legacy `vndDep` currency-drag assumption as wealth math, but that must remain separate from live FX or macro ingestion.

## Legacy Porting Rule

Sovereign Wealth math should be ported from the legacy dashboard first. Do not silently change formulas while porting. If a dashboard behavior is wrong or needs improvement, first reproduce it in a test, then document the intentional change.
