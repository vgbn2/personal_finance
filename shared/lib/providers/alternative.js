const { fetchJson } = require('./common');

async function fetchKalshiPredictionEvent(eventTicker) {
  const url = `https://external-api.kalshi.com/trade-api/v2/events/${eventTicker}`;
  return fetchJson(url);
}

async function fetchPolymarketHistoricalPrices(slug) {
  // gamma-api.polymarket.com logic
  return [];
}

async function fetchAlternativeMeFearGreed() {
  const url = 'https://api.alternative.me/fng/?limit=1';
  const data = await fetchJson(url);
  const val = data?.data?.[0];
  if (!val) {
    throw new Error('Alternative.me Fear & Greed response missing data');
  }
  const parsedVal = Number(val.value);
  const ts = Number(val.timestamp);
  return {
    family: 'sentiment',
    provider: 'alternative_me',
    symbol: 'fear_and_greed',
    metric: 'fear_and_greed',
    value: Number.isFinite(parsedVal) ? parsedVal : null,
    classification: val.value_classification || 'Neutral',
    timestamp: Number.isFinite(ts) ? new Date(ts * 1000).toISOString() : new Date().toISOString()
  };
}

module.exports = {
  fetchKalshiPredictionEvent,
  fetchPolymarketHistoricalPrices,
  fetchAlternativeMeFearGreed
};
