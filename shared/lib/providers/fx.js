const { fetchJson } = require('./common');

function resolveCurrencyPair(symbol) {
  const normalized = String(symbol || '').trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (normalized.length !== 6) {
    throw new Error(`Unsupported FX symbol format: ${symbol}`);
  }
  return {
    base: normalized.slice(0, 3),
    quote: normalized.slice(3),
    symbol: normalized,
  };
}

async function fetchFrankfurterFx(symbol) {
  const pair = resolveCurrencyPair(symbol);
  const url = `https://api.frankfurter.app/latest?from=${pair.base}&to=${pair.quote}`;
  const data = await fetchJson(url);
  const rate = Number(data.rates?.[pair.quote]);
  if (!Number.isFinite(rate)) {
    throw new Error(`Frankfurter response missing rate for ${pair.symbol}`);
  }
  return {
    family: 'fx',
    provider: 'frankfurter',
    symbol: pair.symbol,
    timeframe: '1d',
    timestamp: data.date ? new Date(`${data.date}T00:00:00Z`).toISOString() : new Date().toISOString(),
    close: rate,
    price: rate,
    source: 'frankfurter',
    source_url: url,
  };
}

async function fetchFrankfurterHistory(symbol, days = 365) {
  const pair = resolveCurrencyPair(symbol);
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - days);
  
  const startStr = startDate.toISOString().split('T')[0];
  const endStr = endDate.toISOString().split('T')[0];
  
  const url = `https://api.frankfurter.app/${startStr}..${endStr}?from=${pair.base}&to=${pair.quote}`;
  const data = await fetchJson(url);
  
  if (!data.rates) {
    throw new Error(`Frankfurter history response missing rates for ${pair.symbol}`);
  }
  
  return Object.entries(data.rates).map(([date, rates]) => {
    const rate = Number(rates[pair.quote]);
    return {
      family: 'fx',
      provider: 'frankfurter',
      symbol: pair.symbol,
      timeframe: '1d',
      timestamp: new Date(`${date}T00:00:00Z`).toISOString(),
      open: rate,
      high: rate,
      low: rate,
      close: rate,
      price: rate,
      volume: 0
    };
  });
}

module.exports = {
  resolveCurrencyPair,
  fetchFrankfurterFx,
  fetchFrankfurterHistory,
};