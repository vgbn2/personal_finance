// [REWRITE] This monolith is being split into:
//   bt.js          — commandBt()
//   optimize.js    — commandOptimize()
//   edge_decay.js  — commandEdgeDecay()
//   features.js    — commandFeatures(), commandModels()
//   lib.js         — shared helpers (loadUsableSources, backtestDataQualityError, etc.)
//
// Re-export stubs so sovereign_cli.js loads during the rewrite.

async function commandBacktest()   { console.error('[STUB] commandBt — not yet implemented'); return 1; }
async function commandOptimize()   { console.error('[STUB] commandOptimize — not yet implemented'); return 1; }
async function commandEdgeDecay()  { console.error('[STUB] commandEdgeDecay — not yet implemented'); return 1; }
async function commandDemo()       { console.error('[STUB] commandDemo — not yet implemented'); return 1; }
async function commandIndicators() { console.error('[STUB] commandIndicators — not yet implemented'); return 1; }
async function commandModelCompare(){ console.error('[STUB] commandModelCompare — not yet implemented'); return 1; }

function buildOptimizationGrid() { return []; }

module.exports = {
  commandBacktest, commandOptimize, commandEdgeDecay,
  commandDemo, commandIndicators, commandModelCompare,
  buildOptimizationGrid,
};
