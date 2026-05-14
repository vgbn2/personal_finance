# Quickstart

This guide orients a new contributor to the current Phase 1 trading-platform scaffold.

The repository currently prioritizes file names, module ownership, and documentation contracts for market data, CNN signals, portfolio monitoring, and execution. The old wealth executable is legacy smoke-test context, not the active product direction.

## Prerequisites

Required:

- C++20 compiler
- CMake 3.10 or newer
- a CMake-supported build backend such as Make, Ninja, MSBuild, or MinGW Makefiles

Currently not required:

- Python packages
- Node.js packages
- Rust crates
- ONNX Runtime
- SQLite
- broker credentials
- Docker

## Build

From the repository root:

```bash
cmake -S . -B build
cmake --build build
ctest --test-dir build/cpp_core
```

On Windows PowerShell, the same commands apply:

```powershell
cmake -S . -B build
cmake --build build
ctest --test-dir build/cpp_core
```

If CMake is not installed, install it before treating the project as fully verified. A direct `g++` build can be used as a local smoke test, but CMake is the project build path.

## Legacy Smoke Test

If the legacy executable is restored or available in a local build, it can be used as a smoke test:

```bash
./build/cpp_core/sovereign_wealth
```

Windows PowerShell:

```powershell
.\build\cpp_core\sovereign_wealth.exe
```

Run with sample config:

```bash
./build/cpp_core/sovereign_wealth --load config/phase1_default.json
```

Windows PowerShell:

```powershell
.\build\cpp_core\sovereign_wealth.exe --load .\config\phase1_default.json
```

## Legacy Expected Output

The old wealth baseline was:

```text
Initial: 1000.0M
Years: 20
Annual Return: 12.0%
Final: 9646.3M
Total Growth: 9.6x
```

The exact regression target used by the test is:

```text
1000M at 12% annual return for 20 years -> 9646.293093274M
```

## Where To Start Coding

For current scaffold work:

- file-name ownership: `docs/scaffold_manifest.md`
- asset and data contract: `docs/data_ingestion.md`
- CNN pipeline: `docs/cnn_pipeline.md`
- execution and portfolio monitoring: `docs/execution_portfolio.md`
- core scaffold folders: `cpp_core/src/assets`, `cpp_core/src/data`, `cpp_core/src/ingestion`, `cpp_core/src/features`, `cpp_core/src/ml`, `cpp_core/src/research`, `cpp_core/src/risk`, `cpp_core/src/execution`, `cpp_core/src/portfolio`

Do not add live data downloads, model inference, broker calls, or portfolio-monitoring side effects until the corresponding phase is opened.
