// [REWRITE] manifest.js — pure COMMAND_MANIFEST data object.
// Target: no side-effects at require() time, no inline logic, no wallet reads.
// Lazy helpers move to manifest_helpers.js.
// Reference: personal_finance_draft/backend/cli/tui/manifest.js

const COMMAND_MANIFEST = {
  categories: [],
  commands: {
    op: [], backend: [], research: [], strategy: [],
    propfirm: [], trade: [], polymarket: [], bot: [], settings: [], account: [],
  },
};

function getCachedSymbols()        { return []; }
function getCachedTimeframes()     { return ['1d', '1h', '15m']; }
function getCachedUniverse()       { return { symbols: [], timeframes: ['1d', '1h', '15m'] }; }
function getRegisteredStrategies() { return []; }

module.exports = {
  ...COMMAND_MANIFEST,
  getCachedSymbols,
  getCachedTimeframes,
  getCachedUniverse,
  getRegisteredStrategies,
};
