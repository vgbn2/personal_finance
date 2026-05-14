# Documentation

This directory is the contributor-facing documentation set for Sovereign Finance. It explains what the project is, what is buildable today, what is planned later, and how contributors should work without confusing future scope with current implementation.

## Project In One Minute

Sovereign is a phased C++20 trading-platform scaffold. The long-term product has four active trading pillars:

- Market Data: asset identity, ingestion, validation, and feature streams
- Research And Signals: quant research, backtests, CNN features, and model outputs
- Portfolio And Risk: positions, PnL, exposures, risk limits, and monitoring
- Execution: paper trading, broker adapters, order state, and kill switches

Personal-finance and wealth logic is legacy context. Do not add new salary, budget, mortgage, or retirement-planning surfaces unless the data is explicitly used as a macro or consumer-sentiment input for trading.

## Current Buildable Scope

Current phase: Phase 1, Trading Platform Scaffold.

Scaffolded today:

- C++ market module file names
- CLI command file names
- web route and dashboard file names
- config file names
- model artifact file names
- documentation contracts for data ingestion, CNN signals, execution, and portfolio monitoring

Not buildable yet:

- real market data ingestion
- validated stock and index calculations
- CNN training or inference
- portfolio monitoring service
- paper or live execution
- market backtesting
- quant research workflow automation
- FX and macroeconomic data ingestion
- economy health scoring
- option pricing
- deployment stack

## Documentation Map

- `QUICKSTART.md`: build, test, and run the current Phase 1 system
- `spec.md`: product scope, phase roadmap, and current behavior contract
- `legacy_math.md`: legacy dashboard formulas and C++ porting plan
- `scaffold_manifest.md`: trading-platform file-name manifest and ownership map
- `data_ingestion.md`: asset, OHLCV, macro, and sentiment data contract
- `cnn_pipeline.md`: planned CNN feature, tensor, label, and signal contract
- `execution_portfolio.md`: planned order, risk, broker, and portfolio monitoring contract
- `macro_model.md`: future FX, macro regime, and economy health roadmap
- `quant_research.md`: future quant research process and promotion rules
- `engineering.md`: architecture, module ownership, build targets, and coding boundaries
- `operations.md`: local workflow, verification, troubleshooting, and release hygiene
- `CONTRIBUTING.md`: team rules for changes, reviews, documentation, and dependencies
- `DEPLOYMENT.md`: future deployment plan, clearly separated from Phase 1
- `web_api.md`: future dashboard/API contract, not active in Phase 1

## How To Read These Docs

Start here, then read `QUICKSTART.md`. After you can build and run the project, read `legacy_math.md` and `engineering.md` before changing wealth code. Use `spec.md` when you need to understand the product roadmap or phase boundaries.

If a document says a feature is planned, do not write code against it as if it already exists. Planned features become implementation targets only when their phase is opened.

## Contributor Rule

The main maintenance rule is simple: keep the docs aligned with the buildable system. If a command, executable, folder, dependency, or public API is not real yet, label it as planned.
