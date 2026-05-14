# Technology Stack

> Generated for the trading-platform scaffold on 2026-05-14.

## Runtime

| Technology | Version | Purpose |
|------------|---------|---------|
| C++ | C++20 | Core calculations, data contracts, backtests, risk, and execution interfaces |
| CMake | 3.20+ | C++ build configuration |
| Rust | Planned | CLI command surface |
| Node.js | Planned | Web dashboard and API |
| ONNX | Planned | CNN and regime model artifact format |

## Production Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| express | ^4.18.0 | Planned web API server |
| socket.io | ^4.5.0 | Planned streaming dashboard updates |
| ejs | ^3.1.0 | Planned server-rendered views |
| dotenv | ^16.0.0 | Planned local environment config |

## Development Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| CTest | CMake bundled | C++ tests |
| nodemon | Not pinned | Planned web dev reload, referenced by script only |

## Infrastructure

| Service | Provider | Purpose |
|---------|----------|---------|
| GitHub Actions | GitHub | Planned CI |
| Docker | Local/container host | Planned packaging |
| Kubernetes | Any | Planned deployment manifests |
| Terraform | Any | Planned infrastructure provisioning |

## Configuration

| Variable/File | Purpose | Required |
|---------------|---------|----------|
| `.env` | Local secrets, never committed | No |
| `config/data_sources.yaml` | Source and universe config | Yes for ingestion work |
| `config/feature_engineering.yaml` | Feature and CNN windows | Yes for model work |
| `config/strategies.yaml` | Strategy parameters and promotion gates | Yes for strategy work |
| `config/risk_management.yaml` | Risk limits and execution defaults | Yes for execution work |
| `models/metadata.json` | Model registry metadata | Yes for model work |
