# Architecture

> Generated for the trading-platform scaffold on 2026-05-14.

## Overview

Sovereign is organized as a trading platform, not a personal-finance app. The current repository is primarily a scaffold: file names, folders, docs, configs, and placeholder contracts that let contributors work on assets, ingestion, CNN signals, backtests, execution, and portfolio monitoring without inventing competing module layouts.

## System Diagram

```text
market / macro / news / sentiment sources
        |
        v
ingestion adapters
        |
        v
validated market frames + data quality reports
        |
        +--> indicators / feature frames --> CNN tensor builder --> model inference --> signals
        |
        +--> backtests / research / cost model / promotion gates
        |
        v
strategy decisions
        |
        v
pre-trade risk gates
        |
        v
paper broker or live broker adapter
        |
        v
trade log -> portfolio state -> monitoring, alerts, CLI, web API
```

## Components

### C++ Core

- **Purpose:** future high-performance asset calculations, indicators, backtests, risk checks, CNN inference boundary, and execution contracts.
- **Location:** `cpp_core/src`
- **Key folders:** `assets`, `data`, `ingestion`, `features`, `ml`, `backtest`, `research`, `risk`, `execution`, `portfolio`

### CLI

- **Purpose:** future operational commands for data refresh, signals, backtests, portfolio state, execution, paper trading, retraining, and alerts.
- **Location:** `cli/src`

### Web

- **Purpose:** future dashboard and API surface for strategies, signals, portfolio, backtests, and monitoring.
- **Location:** `web`

### Config

- **Purpose:** source lists, feature windows, strategy parameters, risk limits, regime routing, app mode, and alerts.
- **Location:** `config`

### Models

- **Purpose:** placeholder model artifacts and metadata for CNN and regime-classifier work.
- **Location:** `models`

## Data Flow

Validated data is the boundary between ingestion and calculations. Calculations, CNN tensors, backtests, signals, and portfolio marks should only consume records that have passed data quality checks.

## Integration Points

| External Service | Type | Purpose |
|------------------|------|---------|
| Equity data provider | API | Stocks and ETFs |
| Index data provider | API | Index levels, constituents, volatility indexes |
| FX data provider | API | Currency pairs and conversion rates |
| Crypto exchange | API/WebSocket | Spot and derivative prices |
| Macro provider | API | Inflation, rates, labor, wage growth, sentiment |
| Broker/exchange | API | Paper or live order routing after risk gates |

## Conventions

- Empty or comment-only files are intentional scaffold files.
- New trading modules should use existing folder names instead of creating parallel structures.
- Personal-finance logic is legacy/reference context.
- Wage data is allowed only as macro labor-market or consumer-sentiment input.
- Live execution must default off.

## Technical Debt

- [ ] Many modules are placeholders and need real interfaces.
- [ ] Build configuration does not yet compile the trading modules.
- [ ] Existing legacy wealth files are inconsistent with the trading-platform direction.
- [ ] Empty web and CLI files need package/build definitions before they are runnable.
- [ ] Real test samples are needed for data quality, indicators, CNN tensor creation, risk gates, and portfolio accounting.
