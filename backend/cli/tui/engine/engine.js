// [REWRITE] Split into:
//   engine/primitives.js  — promptSelect, promptMultiSelect, promptText, promptConfirm, raw-mode helpers
//   engine/menu.js        — runInteractiveMenu() navigation loop
//
// This file is the entry point — re-export everything from both modules once implemented.
// See personal_finance_draft/backend/cli/tui/engine/engine.js for the current monolith reference.

module.exports = {
  // promptSelect, promptMultiSelect, promptText, promptConfirm,
  // isRichTerminal, runInteractiveMenu, renderSigmaSparkline, renderCorrelationHeatmap,
  // setAuthEmail, setStatusLine, _test
};
