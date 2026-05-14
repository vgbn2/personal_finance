# Product Specification

This file explains the product direction and phase boundaries. It is not a claim that all described systems already exist.

## Mission

Sovereign is intended to become a C++-centered trading platform for market analysis, asset data ingestion, CNN-assisted signal generation, portfolio monitoring, and controlled trade execution.

The project should grow in phases. Each phase must produce a buildable, testable system before the next phase adds more surface area.

The personal-finance and wealth work is legacy context. It should remain separate from the trading platform unless a field is reused as macro, consumer-sentiment, or purchasing-power data.

## Pillars

## Legacy Wealth Context

Purpose: preserve prior personal-finance assumptions without letting them dominate the trading-platform architecture.

Allowed trading uses:

- wage growth as a macro labor-market signal
- inflation and currency depreciation as macro regime inputs
- household demand data as consumer-sentiment context

Status: legacy/reference. Not the active product direction.

## Sovereign Markets

Purpose: find and evaluate tactical market opportunities.

Planned capabilities:

- market data ingestion
- FX and macroeconomic data ingestion
- macro regime classification
- economy health scoring as a market and risk input
- quantitative research workflow
- indicators
- backtesting
- Black-Scholes and options analysis
- Kelly sizing
- correlation analysis
- slippage and fee modeling

Status: scaffolded by file names and docs. Real ingestion, calculations, backtesting, and model inference are not implemented yet.

## Macro And Sentiment Data

Purpose: provide market regime, economy health, labor-market, and consumer-sentiment inputs for trading decisions.

Planned capabilities:

- inflation, rates, yield curve, FX, wage growth, and employment series
- consumer sentiment and demand proxies
- news and market sentiment features
- timestamped known-at-time observations
- economy health score for market regime context

Status: scaffolded by docs and config only. Not implemented.

## Sovereign Terminus

Purpose: connect decisions to controlled execution.

Planned capabilities:

- broker and exchange adapters
- dry-run execution
- live execution gates
- kill switches
- operational monitoring

Status: planned, not active in Phase 1.

## Active Phase Contract

Phase 1: Trading Platform Scaffold.

Scope:

- file names for market data, research, CNN, execution, and monitoring modules
- documentation contracts for asset calculations and data quality
- config placeholders for data sources, strategies, risk, features, and alerts
- model artifact placeholders for CNN and regime classification

Non-scope:

- live data ingestion
- CNN training or inference
- live trade execution
- production portfolio monitoring
- new personal-finance features

Existing wealth code and docs may remain as legacy reference until removed or archived.

## Phase Roadmap

Phase 1: Trading Platform Scaffold.

- asset, ingestion, feature, CNN, research, risk, execution, and portfolio file names
- docs for data contracts and module ownership
- config and model placeholder names
- no live trading and no real data ingestion

Phase 2: Data Contracts And Asset Calculations.

- implement asset identity and universe loading
- implement OHLCV parsing and validation
- implement stock and index return calculations
- implement technical indicators and correlation
- implement data quality reports
- allow macro and wage/labor data only as market regime or consumer-sentiment inputs

Phase 3: Research, Backtesting, And CNN Features.

- backtest engine
- transaction cost model
- walk-forward validation
- feature frames and labels
- CNN tensor builder
- model metadata and inference interface

Phase 4: Macro/Market Model.

- market data ingestion
- FX and macroeconomic data ingestion
- data quality checks for market and macro observations
- macro regime classification
- economy health score as a market/risk regime input
- quant research hypothesis lifecycle
- backtest integrity checks
- transaction cost modeling
- volatility modeling
- indicators
- backtesting
- performance metrics
- correlation
- position sizing

Phase 5: Portfolio Monitoring And Execution.

- expanded CLI
- web dashboard
- macro and economy health reporting surfaces
- portfolio state, PnL, exposure, and risk dashboards
- paper trading
- broker adapters
- dry-run and live execution gates
- deployment packaging

## Non-Goals For Phase 1

Phase 1 should not implement:

- live market data
- real stock or index ingestion
- CNN training or inference
- portfolio monitoring service
- paper or live trade execution
- FX or macroeconomic data ingestion
- economy health scoring
- quant research workflow automation
- options pricing
- ONNX inference
- deployment automation
- SQLite persistence

These are important later, but adding them now would make the skeleton harder to understand and maintain.
