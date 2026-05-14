# Sovereign Trading Platform

Sovereign is a phased trading-platform scaffold for market data ingestion, quantitative research, CNN-driven signal generation, portfolio monitoring, and controlled trade execution.

The earlier personal-finance/wealth work is legacy context. Treat it as done unless a variable becomes useful to trading, macro modeling, or consumer sentiment. For example, wage growth can be a macro labor-market feature, but this repository should not grow into a budgeting or salary-planning product.

## Start Here

Read the documentation in this order:

1. `docs/README.md`
2. `docs/QUICKSTART.md`
3. `docs/spec.md`
4. `docs/engineering.md`
5. `docs/scaffold_manifest.md`
6. `docs/data_ingestion.md`
7. `docs/cnn_pipeline.md`
8. `docs/execution_portfolio.md`
9. `docs/CONTRIBUTING.md`

## Current Phase

Phase 1: Trading Platform Scaffold.

Repository focus:

- asset data ingestion file layout
- stocks, indices, FX, crypto, macro, news, and sentiment source boundaries
- CNN feature and tensor pipeline names
- backtest, signal, risk, execution, and portfolio monitoring module names
- docs that explain ownership and data contracts for contributors

Not implemented yet:

- real data downloads
- validated OHLCV storage
- CNN training or inference
- live broker execution
- production portfolio monitoring

## Quick Build

```bash
cmake -S . -B build
cmake --build build
ctest --test-dir build/cpp_core
```

Run:

```bash
./build/cpp_core/sovereign_wealth --load config/phase1_default.json
```

Windows PowerShell:

```powershell
.\build\cpp_core\sovereign_wealth.exe --load .\config\phase1_default.json
```

## Documentation

The `docs/` folder is the main contributor documentation set. It distinguishes scaffolded file names from implemented behavior.
