const { cachedFetch, fetchJson, REPO_ROOT } = require('./common');
const path = require('node:path');
const fs = require('node:fs');

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';
const ID_MAP_PATH = path.join(REPO_ROOT, 'storage', 'data', 'cache', 'coingecko_id_map.json');

/**
 * Loads or refreshes the CoinGecko symbol-to-id mapping.
 */
async function getCoinGeckoIdMap() {
  if (fs.existsSync(ID_MAP_PATH)) {
    const stats = fs.statSync(ID_MAP_PATH);
    const ageHours = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60);
    if (ageHours < 24) {
      return JSON.parse(fs.readFileSync(ID_MAP_PATH, 'utf8'));
    }
  }

  console.log('[COINGECKO] Refreshing ID map...');
  const list = await fetchJson(`${COINGECKO_BASE}/coins/list`);
  const map = {};
  list.forEach(coin => {
    map[coin.symbol.toLowerCase()] = coin.id;
  });

  fs.mkdirSync(path.dirname(ID_MAP_PATH), { recursive: true });
  fs.writeFileSync(ID_MAP_PATH, JSON.stringify(map, null, 2), 'utf8');
  return map;
}

/**
 * Fetches historical market data (price, market cap, volume) from CoinGecko.
 * @param {string} symbol - The coin symbol (e.g., "BTC")
 * @param {number} days - Number of days of history
 * @returns {Promise<Object[]>}
 */
async function fetchCoinGeckoHistory(symbol, days = 30) {
  const map = await getCoinGeckoIdMap();
  const id = map[symbol.toLowerCase()];
  if (!id) {
    throw new Error(`[COINGECKO] Could not find ID for symbol: ${symbol}`);
  }

  const url = `${COINGECKO_BASE}/coins/${id}/market_chart?vs_currency=usd&days=${days}`;
  const data = await fetchJson(url);

  // CoinGecko returns [timestamp, value] arrays
  const records = [];
  const prices = data.prices || [];
  const marketCaps = data.market_caps || [];
  const volumes = data.total_volumes || [];

  for (let i = 0; i < prices.length; i++) {
    const [timestamp, price] = prices[i];
    const [, marketCap] = marketCaps[i] || [0, 0];
    const [, volume] = volumes[i] || [0, 0];

    records.push({
      family: 'crypto',
      provider: 'coingecko',
      symbol: symbol.toUpperCase(),
      timestamp: new Date(timestamp).toISOString(),
      price: price,
      market_cap: marketCap,
      volume_24h: volume,
      source: 'coingecko-api'
    });
  }

  return records;
}

module.exports = {
  fetchCoinGeckoHistory,
  getCoinGeckoIdMap
};
