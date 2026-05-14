# CNN Pipeline Roadmap

This document defines the planned CNN data path for market prediction and regime-aware signal generation. It is a scaffold contract only.

## Goal

CNN models should consume validated asset, macro, and sentiment features and produce timestamped signals that can be tested before they affect execution.

The model must never read future data, unvalidated data, or portfolio state that would not have been known at prediction time.

## Feature Flow

```text
validated market frame
  -> technical features
  -> macro and sentiment joins
  -> feature normalization
  -> rolling window tensor
  -> CNN inference
  -> signal with confidence and expiry
```

## Tensor Contract

Planned `CnnTensor` fields:

- `asset_id`
- `as_of`
- `lookback_window`
- `feature_names`
- `shape`
- `values`
- `normalization_version`
- `source_frame_id`

The tensor builder should fail loudly if:

- a window has missing required observations
- feature timestamps exceed `as_of`
- normalization metadata is unavailable
- feature order differs from model metadata

## Labels

Training labels should be explicit:

- forward return over a configured horizon
- benchmark-relative return
- volatility-adjusted return
- drawdown event
- regime transition

Labels belong in research and training data. They must not be available to inference code.

## Model Artifacts

Planned model files:

- `models/cnn_v3.onnx`
- `models/regime_classifier.onnx`
- `models/metadata.json`
- `models/feature_config.yaml`

`metadata.json` should eventually define:

- model name and version
- training data range
- feature order
- expected tensor shape
- normalization version
- label definition
- validation metrics
- promotion status

## Signal Output

Planned `Signal` fields:

- `signal_id`
- `asset_id`
- `as_of`
- `model_version`
- `direction`
- `confidence`
- `target_horizon`
- `expiry`
- `reason_codes`
- `data_quality_report_id`

Signals are research outputs until they pass backtesting, risk checks, and paper-trading gates.
