# Sovereign — Requirements & Specification

Single source of truth for what Sovereign is, what exists today, the contracts
future work must satisfy, and the phase order in which it gets built. If a fact
about scope or status lives anywhere, it lives here. Other docs cover *how to
build/run/contribute* (`QUICKSTART.md`, `operations.md`, `CONTRIBUTING.md`), not
*what the system is*.

---

## 1. Current State (authoritative)

Project: a C++20-centered **quantitative trading platform** — market data
ingestion, quant research, CNN-assisted signals, portfolio/risk monitoring, and
controlled execution.

Active phase: **Phase 1 — Trading Platform Scaffold.**

What is real today:

- Directory and file-name layout for the core modules (see §5).
- Config placeholder files under `config/`.
- This documentation set.

What is **not** implemented (do not write code against it as if it exists):

- Real market/FX/macro data ingestion or validated OHLCV storage.
- Indicators, backtesting, correlation, or research workflow.
- CNN/regime training or inference (`models/*.onnx` are 0-byte placeholders).
- Portfolio monitoring service.
- Paper or live execution, broker adapters, kill switches.
- Web dashboard / API and any deployment stack.

That code is **deprecated** (the wealth engine is a stub). Personal-finance
logic is reference only — see §11. Do not add salary, budget, mortgage, or
retirement surfaces unless the data is used strictly as a macro or
consumer-sentiment input for trading.

---

## 2. Mission & Scope

Sovereign grows in phases. Each phase must produce a buildable, testable system
before the next adds surface area.

Pillars:

- **Market Data** — asset identity, ingestion, validation, feature streams.
- **Research & Signals** — quant research, backtests, CNN features, model output.
- **Portfolio & Risk** — positions, PnL, exposure, risk limits, monitoring.
- **Execution** — paper trading, broker adapters, order state, kill switches.

Core invariant: **validated data is the boundary between ingestion and
everything downstream.** Calculations, tensors, backtests, signals, and marks
only ever consume records that passed data-quality checks. Live execution
defaults off and stays behind explicit gates.

---

## 4. Technology Stack

| Layer | Tech | Status |
|-------|------|--------|
| Core | C++20, CMake 3.20+ | Active build path |
| CLI | Rust | Planned |
| Web | Node.js (express, socket.io, ejs) | Planned |
| Models | ONNX | Planned |
| CI/Infra | GitHub Actions, Docker, K8s, Terraform | Planned |

Phase 1 uses the C++ standard library only. Before adding any dependency:
confirm the active phase needs it, document it, isolate it behind a small module
boundary, and test the behavior that depends on it. Deferred dependencies (JSON
lib, SQLite, HTTP/WebSocket, ONNX Runtime, Node, Docker) must not affect the
Phase 1 build until their phase is active.

Config files (`config/`): `data_sources.yaml`, `feature_engineering.yaml`,
`strategies.yaml`, `risk_management.yaml`, `regime_routing.yaml`, `alerts.yaml`,
`app_config.yaml`, `phase1_default.json`. `models/metadata.json` is the model
registry. `.env` holds local secrets and is never committed.

---

## 5. Module & File Ownership

C++ core (`cpp_core/src/<module>`):

| Module | Owns |
|--------|------|
| `assets` | asset identity, universe, instrument type |
| `data` | market events, OHLCV bars, order book, corporate actions, validated frames, quality reports |
| `ingestion` | equity / index / fx / crypto / macro / news / sentiment adapters, stream router |
| `features` | technical / macro / sentiment features, label builder, lookahead guard |
| `ml` | CNN tensor builder, inference, model registry |
| `backtest` | backtester, equity curve, trades |
| `research` | hypotheses, promotion gates, walk-forward splits, cost model |
| `indicators` / `correlation` / `stats` / `position_sizing` / `strategies` / `regime` | calculations supporting research and signals |
| `risk` | risk limits, pre-trade checks, drawdown guard |
| `portfolio` | portfolio state, positions, PnL, exposure monitor |
| `execution` | execution interface, orders/state, paper broker, live adapter, TWAP/VWAP, kill switch |
| `parser` / `utils` | parsing/normalization and shared helpers |

Surfaces: `cli/src/commands/*` (data, signal, backtest, portfolio, execute,
paper_trade, retrain), `cli/src/broker_api/*`, `web/server/routes/*`,
`web/public/js/*`.

Data placeholders: `data/market_data.db`, `data/cache/last_fetch.json`,
`data/portfolio.json`, `data/trades/trade_log_YYYY_MM.sqlite`,
`data/backtests/backtest_YYYYMMDD_strategy.json`. Never commit bulk market data —
only tiny samples for tests.

---

## 6. Data Ingestion Contract

One coherent asset stream must exist before strategies, models, or execution.
Asset domains: stocks/ETFs, equity indices, futures (where supported), FX,
crypto spot/derivatives, volatility indexes, macro series, news/sentiment. Every
asset resolves to a stable internal `asset_id` before it enters anything
downstream.

Records:

- **`Asset`** — `asset_id, symbol, name, instrument_type, exchange, currency,
  timezone, tick_size, lot_size, active_from, active_to`.
- **`OhlcvBar`** — `asset_id, timestamp, timeframe, open, high, low, close,
  volume, source, ingested_at`. Indices and stocks share this contract;
  constituents/weights/rebalances are separate records.
- **`DataQualityReport`** — missing/duplicate timestamps, stale observations,
  bad OHLC ordering, split/corporate-action mismatch, timezone mismatch,
  lookahead risk, source freshness.

Validation happens **before** calculations. Validated fields must support:
returns, rolling volatility, drawdown, ATR, RSI, MACD, Bollinger bands, realized
correlation, liquidity/spread proxies, benchmark-relative return, exposure.

Macro/sentiment inputs (wage growth as labor-market strength, employment/income
as demand proxies, sentiment surveys as regime inputs, inflation/FX depreciation
as purchasing-power and risk-regime inputs) must be timestamped as
known-at-time observations to avoid lookahead.

Storage layers: raw source cache (replay) → normalized store → feature store →
signal store → trade/portfolio store.

---

## 7. Feature & CNN Pipeline Contract

CNN models consume validated asset/macro/sentiment features and emit timestamped
signals testable before they affect execution. A model must never read future
data, unvalidated data, or portfolio state unknowable at prediction time.

Flow: validated frame → technical features → macro/sentiment joins →
normalization → rolling-window tensor → inference → signal with confidence &
expiry.

**`CnnTensor`**: `asset_id, as_of, lookback_window, feature_names, shape, values,
normalization_version, source_frame_id`. The builder fails loudly if a window
has missing required observations, feature timestamps exceed `as_of`,
normalization metadata is missing, or feature order differs from model metadata.

Labels (forward/benchmark-relative/vol-adjusted return, drawdown event, regime
transition) belong to research/training only — never visible to inference.

`models/metadata.json` should define name+version, training range, feature
order, tensor shape, normalization version, label definition, validation
metrics, promotion status.

**`Signal`**: `signal_id, asset_id, as_of, model_version, direction, confidence,
target_horizon, expiry, reason_codes, data_quality_report_id`. Signals are
research outputs until they pass backtesting, risk, and paper-trading gates.

---

## 8. Research & Backtesting Requirements

Quant research = systematic search for repeatable, testable edges. A
hypothesis is not an edge until it survives the lifecycle. Each
**`ResearchHypothesis`** tracks name/owner, universe, data domains, features,
test/validation windows, benchmark, holding period, capacity, cost assumptions,
failure criteria, promotion status.

Lifecycle: Draft → Data Ready → Backtested → Validated → Promoted → Retired.

Edge validation must consider absolute and benchmark-relative return, drawdown
depth/duration, hit rate/payoff, turnover/capacity, concentration, parameter
sensitivity, behavior across regimes, robustness after costs. Prefer simple
explanations; fragile parameter fits stay unpromoted.

Backtest integrity must reject/flag lookahead data, survivorship bias, timestamp
mismatch, revised macro used as known-at-time, leaking walk-forward windows,
missing corporate actions, unrealistic fills/fees/borrow. Results must be
reproducible from versioned inputs and config.

**`CostModel`** covers commissions, spread, slippage, market impact, funding,
borrow, FX conversion, taxes/fees. Report gross **and** net; a cost-ignoring
strategy is not production-ready.

Portfolio construction defines sizing (fixed / vol-targeting / Kelly-inspired /
constrained), gross/net exposure limits, concentration, correlation controls,
drawdown/leverage limits, cash/collateral, rebalance frequency — each with its
assumptions and failure modes stated.

Promotion to production requires: documented hypothesis, validated data quality,
reproducible backtest, realistic costs, out-of-sample/walk-forward evidence,
risk limits, failure/retirement criteria, review approval, execution controls.

---

## 9. Execution & Portfolio Monitoring Contract

**No signal becomes an order directly.** Flow: signal → strategy decision →
proposed order → pre-trade risk check → paper or live broker → order-state
updates → trade log → portfolio state → monitoring/alerts. Live execution stays
behind explicit config, credentials, dry-run controls, and kill switches.

**`Order`**: `order_id, asset_id, side, order_type, quantity, limit_price,
time_in_force, strategy_id, signal_id, created_at, status`. States: proposed →
risk_rejected | submitted → partially_filled → filled | cancelled | failed.

Pre-trade risk gates (broker-independent): max order/position notional, max
gross/net exposure, max leverage, max daily loss, max drawdown, stale-data
rejection, trading-disabled flag, unsupported asset/route.

Portfolio state: cash, positions by `asset_id`, average cost, realized &
unrealized PnL, exposure by asset/sector/currency/strategy, margin/collateral,
open orders, last-mark timestamp. Monitoring flags stale marks, exposure
breaches, large drawdowns, rejected orders, failed broker calls, missing trade
logs.

Paper and live trading share one execution interface; broker adapters
(`gate_io_api`, `mt5_native`, `order_executor`, `paper_broker`,
`live_broker_adapter`) translate internal orders to broker APIs, but risk checks
stay broker-independent.

---

## 10. Macro & Market Model (future)

Macro inputs are future market/risk inputs and must not change the Phase 1/2
build or create live ingestion before their phase opens.

Domains: FX (USD/VND, DXY, majors), inflation (CPI, expected), rates
(policy/treasury/yield curve, real rates), risk (VIX-like vol, credit/liquidity
stress), markets (OHLCV, spreads, implied/realized vol). All require timestamped
observations, source metadata, and quality checks before use.

Future interfaces: `MacroObservation`, `MacroSnapshot`, `MacroRegime`
(expansion / slowdown / inflation shock / credit stress / risk-off; deterministic
for fixed inputs, exposes insufficient-data states), `EconomyHealthScore`
(0=severe stress, 50=neutral, 100=broad strength — a context input, never a
direct trading signal without research validation).

Tests required before any of this is "buildable": missing data warns, stale
observations rejected/flagged, FX depreciation affects only configured paths,
economy-health score deterministic for fixed inputs, regime classifier stable
for known snapshots.

---

## 11. Web / API, Deployment & Legacy (future / reference)

**Web/API** — not in Phase 1. Inspect/display state only (simulations, risk,
backtests, portfolio, signals, quality reports; non-dangerous settings; dry-run
jobs). It must not own core calculations, bypass core validation, store raw
secrets in browser code, or trigger live execution without server-side gates.
Shape: browser → web/local API → CLI/core adapter → `sovereign_core`. Build it
only once the core has stable I/O, a documented config schema, and tests.

**Deployment** — not in Phase 1; local-only today. Future: reproducible release
builds, Docker images, CI build/test, artifact publishing, env-specific config,
secrets handling, monitoring. Before *any* live-execution deployment: dry-run
mode, explicit live flag, confirmation gate, credential-storage policy, audit
logs, kill switch, connection-failure behavior, rollback. Credentials always
from env/encrypted store/secret manager — never hardcoded.

**Legacy wealth (deprecated)** — the prior personal-finance dashboard
(`index.html`, with `simForecast`/`calculateVnPit`) and its C++ wealth engine
are deprecated and not the product direction. Allowed reuse only as trading
inputs: wage growth as macro labor-market signal, inflation/currency
depreciation as macro regime inputs, household demand as consumer sentiment.
Disallowed: salary budgeting UI, spending planner, mortgage amortization as a
product surface.

---

## 12. Phase Roadmap

| Phase | Delivers |
|-------|----------|
| **1 — Scaffold** *(active)* | module/file names, data-contract docs, config & model placeholders. No live data, no execution. |
| **2 — Data Contracts & Calculations** | asset identity & universe loading, OHLCV parsing/validation, stock/index returns, indicators, correlation, data-quality reports. Macro/labor data named as inputs but not live-ingested. |
| **3 — Research, Backtest & CNN Features** | backtest engine, cost model, walk-forward validation, feature frames/labels, CNN tensor builder, model metadata & inference interface. Macro scenario assumptions allowed for research, no live ingestion. |
| **4 — Macro / Market Model** | market + FX + macro ingestion, quality checks, regime classification, economy-health score, research lifecycle, volatility modeling, performance metrics, position sizing. |
| **5 — Portfolio Monitoring & Execution** | expanded CLI, web dashboard, macro/health surfaces, portfolio/PnL/exposure/risk dashboards, paper trading, broker adapters, dry-run & live gates, deployment packaging. |

A phase's features become implementation targets only when that phase is opened.
Do not mix future-phase systems into Phase 1 changes without agreement.
