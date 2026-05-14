# Operations Guide

This document covers day-to-day development, verification, and maintenance operations.

## Local Development Loop

Recommended loop:

```bash
git status --short
cmake -S . -B build
cmake --build build
ctest --test-dir build/cpp_core
```

Windows PowerShell:

```powershell
git status --short
cmake -S . -B build
cmake --build build
ctest --test-dir build/cpp_core
```

The CMake build is legacy smoke-test coverage until the trading-platform modules are implemented. Phase 1 handoff should also verify that scaffold docs and placeholder files match.

## Verification Checklist

Before handing off a change:

- project builds
- tests pass
- warnings are reviewed
- docs match changed behavior
- no build artifacts are included
- no future-phase dependency was added accidentally

## Manual Smoke Test

If CMake is unavailable locally, a direct compiler smoke test may be used during development:

```bash
g++ -std=c++20 -Wall -Wextra -Werror -I ./cpp_core/include \
  ./cpp_core/src/main.cpp \
  ./cpp_core/src/wealth/finance_engine.cpp \
  ./cpp_core/src/wealth/param_loader.cpp \
  -o ./build/manual/sovereign_wealth
```

This does not replace the CMake path for final verification.

## Troubleshooting

Problem: `cmake` command not found.

Resolution: install CMake and ensure it is on `PATH`.

Problem: executable path does not exist.

Resolution: run `cmake --build build` and check whether your generator places binaries under `build/cpp_core`.

Problem: test target not found.

Resolution: confirm `cpp_core/CMakeLists.txt` defines `phase1_compounding_test` and `add_test`.

Problem: linker errors for `FinanceEngine`.

Resolution: this is legacy wealth smoke-test code. Either restore the legacy build path intentionally or keep the trading scaffold docs clear that the wealth executable is not the active product direction.

## Release Hygiene

Before tagging or sharing a build:

- run a clean configure
- run tests
- record compiler and platform
- update docs if commands changed
- keep `build/` and generated binaries out of source control

## Runtime Safety

Phase 1 has no live execution and no external side effects. Current trading-platform files are placeholders and docs.

Future phases involving broker execution must require:

- dry-run mode
- explicit live mode flag
- confirmation gate
- credential storage policy
- operational kill switch
