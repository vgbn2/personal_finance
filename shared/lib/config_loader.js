const fs = require('node:fs/promises');
const path = require('node:path');

/**
 * Robust recursive YAML parser for Sovereign configuration files.
 * Handles nested objects and [a, b, c] lists.
 */
function parseYamlList(raw) {
  const match = raw.match(/\[(.*)\]/);
  if (!match) return [];
  return match[1]
    .split(',')
    .map((item) => item.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
}

function parseYamlRecursive(lines, startLine = 0, targetIndent = 0) {
  const result = {};
  let i = startLine;
  while (i < lines.length) {
    const line = lines[i];
    const indent = line.match(/^\s*/)?.[0].length || 0;
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      i++;
      continue;
    }

    if (indent < targetIndent) {
      return [result, i];
    }

    if (indent === targetIndent) {
      const [key, ...valParts] = trimmed.split(':');
      const val = valParts.join(':').trim();
      const cleanKey = key.trim();

      if (val === '' && i + 1 < lines.length && (lines[i+1].match(/^\s*/)?.[0].length || 0) > indent) {
        const [subObj, nextI] = parseYamlRecursive(lines, i + 1, indent + 2);
        result[cleanKey] = subObj;
        i = nextI;
      } else {
        const cleanVal = val.replace(/^"|"$/g, '');
        result[cleanKey] = val.startsWith('[') ? parseYamlList(val) : (cleanVal === 'true' ? true : (cleanVal === 'false' ? false : cleanVal));
        i++;
      }
    } else {
      i++;
    }
  }
  return [result, i];
}

/**
 * Loads the main market data configuration.
 */
async function loadMarketConfig(configPath) {
  const content = await fs.readFile(configPath, 'utf8');
  const lines = content.split(/\r?\n/);
  const [fullConfig] = parseYamlRecursive(lines);
  
  const sources = fullConfig.sources || {};
  const families = [
    'equities', 'indices', 'commodities', 'fx', 'quote_feeds', 'crypto',
    'pmi', 'macro', 'macro_alt', 'breadth', 'sentiment', 'onchain',
    'prediction_market', 'weather', 'flight', 'crypto_tx', 'satellite_nrt',
    'cargo', 'holdings', 'reserves'
  ];
  families.forEach(f => {
    if (!sources[f]) sources[f] = { enabled: false, providers: [], symbols: [], timeframes: [] };
  });

  return {
    ...sources,
    fred_mappings: fullConfig.fred_mappings || {},
    world_bank_mappings: fullConfig.world_bank_mappings || {},
    prediction_market_keywords: fullConfig.prediction_market_keywords || {},
    breadth_ratios: fullConfig.breadth_ratios || {},
    quality: fullConfig.quality || {}
  };
}

module.exports = {
  parseYamlList,
  parseYamlRecursive,
  loadMarketConfig
};
