# Macro And Market Model Roadmap

This document defines planned macroeconomic and market-regime modeling for Sovereign Markets. It is not active in Phase 1. FX, macroeconomic data ingestion, macro regime classification, and economy health scoring are planned for Phase 4 unless a later roadmap revision changes that boundary.

## Scope Boundary

Macro inputs are future market and risk inputs. They must not change the Phase 1 trading-platform scaffold or create live ingestion before the relevant phase is opened.

The legacy dashboard field `vndDep` remains part of Sovereign Wealth as a currency-drag assumption. It should be ported with the legacy wealth math before it is connected to any live FX or macro data source.

## Future Data Domains

Planned macro and market domains include:

- FX: USD/VND, DXY, and major currency pairs if needed
- inflation: CPI, local inflation, and expected inflation
- rates: policy rates, treasury rates, and yield curves
- risk: VIX-like volatility indexes, credit stress, and liquidity proxies
- markets: OHLCV, volume, spreads, implied volatility, and realized volatility

These domains require timestamped observations, source metadata, and data quality checks before they can feed simulations or strategy research.

## Future Interfaces

The future C++ model may introduce:

- `MacroObservation`: one timestamped macro datapoint with source metadata
- `MacroSnapshot`: an aligned set of macro inputs for one date
- `MacroRegime`: a classified state such as expansion, slowdown, inflation shock, credit stress, or risk-off
- `EconomyHealthScore`: a normalized macro health score from 0 to 100
- `DataQualityReport`: missing data, stale data, timestamp mismatch, and lookahead-risk checks
- `CostModel`: commission, spread, slippage, funding, borrow, and FX conversion costs
- `ResearchHypothesis`: hypothesis metadata, data requirements, test window, and promotion status

These are roadmap concepts, not current public APIs.

## FX And Currency Depreciation

FX data should eventually support:

- currency conversion for market data and portfolio results
- currency depreciation assumptions for wealth planning
- FX conversion costs in strategy returns
- stress scenarios for local purchasing power

`vndDep` is currently documented as a legacy wealth assumption. Phase 2 may port it as part of inflation and currency drag. Phase 4 may replace or augment static assumptions with validated macro or FX inputs.

## Inflation

Inflation inputs may affect:

- real-return reporting
- purchasing-power projections
- spending and cost-of-living assumptions
- macro regime classification
- stress scenarios

Phase 1 has no inflation logic. If legacy inflation drag is preserved, keep it separate from trading-platform macro ingestion.

## Rates And Yield Curves

Rates data may include:

- central bank policy rates
- short-term treasury rates
- long-term treasury rates
- yield curve slope
- real rates when inflation expectations are available

Rates may influence cash return assumptions, discounting, leverage spread analysis, macro regimes, and risk simulations.

## Volatility, Liquidity, And Credit Stress

Risk inputs may include:

- VIX-like volatility indexes
- realized and implied volatility
- credit spreads or credit stress proxies
- liquidity stress proxies
- market breadth and volume deterioration

These inputs should feed risk controls and regime classification only after data quality checks pass.

## Macro Regime Classification

`MacroRegime` should classify aligned macro snapshots into states such as:

- expansion
- slowdown
- inflation shock
- credit stress
- risk-off

The classifier should be deterministic for fixed inputs and versioned configuration. It should expose uncertainty or insufficient-data states rather than forcing a false classification.

## Economy Health Score

Economy health means macroeconomic regime health. It does not refer to Sovereign Vessel body or metabolic health.

`EconomyHealthScore` should normalize macro conditions from 0 to 100:

- 0 means severe macro stress
- 50 means mixed or neutral conditions
- 100 means broad macro strength

The score should be an input to market risk, scenario analysis, and portfolio context. It must not be treated as a direct trading signal without quant research validation.

## Simulation Effects

Macro inputs may eventually affect:

- portfolio context through inflation and currency depreciation assumptions
- market simulations through volatility and regime-conditioned return assumptions
- portfolio risk through stress scenarios and correlation changes
- research through regime filters and cost assumptions

Phase placement:

- Phase 1: scaffold docs and file names only
- Phase 2: asset contracts and calculations; macro/labor data may be named as inputs but not live-ingested
- Phase 3: allow macro scenario assumptions for research and CNN features, but no live ingestion
- Phase 4: implement macro data ingestion, quality checks, regime classification, and economy health scoring
- Phase 5: expose macro and economy health in CLI or web surfaces

## Future Test Expectations

Future macro work should include tests proving:

- missing data produces a data quality warning
- stale macro observations are rejected or flagged
- FX depreciation affects wealth assumptions only where configured
- economy health score is deterministic for fixed inputs
- regime classifier returns stable output for known macro snapshots

Until these tests exist, macro outputs should remain planning concepts rather than buildable behavior.
