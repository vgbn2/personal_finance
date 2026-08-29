const { fetchJson } = require('./common');

function parseNumericValue(val) {
  if (val == null || val === '.' || val === '') return null;
  const parsed = parseFloat(val);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseIsoDate(dateStr, fallbackYearOnly = false) {
  if (!dateStr) return new Date().toISOString();
  const str = String(dateStr).trim();
  if (fallbackYearOnly || /^\d{4}$/.test(str)) {
    return new Date(`${str}-01-01T00:00:00.000Z`).toISOString();
  }
  if (/^\d{4}M\d{1,2}$/i.test(str)) {
    const [year, month] = str.split(/M/i);
    const mm = month.padStart(2, '0');
    return new Date(`${year}-${mm}-01T00:00:00.000Z`).toISOString();
  }
  const parsed = new Date(str.includes('T') ? str : `${str}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
}

async function fetchFredLatest(seriesId) {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) throw new Error('FRED_API_KEY missing');

  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=1`;
  const data = await fetchJson(url);
  const obs = data?.observations?.[0];
  if (!obs) throw new Error(`No observations for FRED series ${seriesId}`);

  const val = parseNumericValue(obs.value);
  return {
    provider: 'fred',
    series_id: seriesId,
    timestamp: parseIsoDate(obs.date),
    value: val !== null ? val : 0,
    source: 'fred',
  };
}

async function fetchWorldBankLatest(country, indicator) {
  const url = `https://api.worldbank.org/v2/country/${country}/indicator/${indicator}?format=json&per_page=60`;
  const data = await fetchJson(url);
  const rows = Array.isArray(data?.[1]) ? data[1] : [];
  const val = rows.find((row) => row && row.value !== null && row.value !== undefined && Number.isFinite(Number(row.value)));
  if (!val) throw new Error(`No World Bank data for ${country}:${indicator}`);

  const parsedVal = Number(val.value);
  return {
    provider: 'world_bank',
    country,
    indicator,
    timestamp: parseIsoDate(val.date, true),
    value: Number.isFinite(parsedVal) ? parsedVal : 0,
    source: 'worldbank',
  };
}

async function fetchFredHistory(seriesId, days) {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) throw new Error('FRED_API_KEY missing');

  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&observation_start=${startDate}`;
  const data = await fetchJson(url);
  const obs = Array.isArray(data?.observations) ? data.observations : [];
  if (obs.length === 0) throw new Error(`No observations for FRED series ${seriesId}`);

  return obs
    .map((o) => {
      const val = parseNumericValue(o?.value);
      if (val === null) return null;
      return {
        provider: 'fred',
        series_id: seriesId,
        timestamp: parseIsoDate(o.date),
        value: val,
        source: 'fred',
      };
    })
    .filter(Boolean);
}

async function fetchWorldBankHistory(country, indicator, days) {
  const startYear = new Date(Date.now() - days * 24 * 60 * 60 * 1000).getFullYear();
  const endYear = new Date().getFullYear();
  const url = `https://api.worldbank.org/v2/country/${country}/indicator/${indicator}?format=json&date=${startYear}:${endYear}`;
  const data = await fetchJson(url);
  const vals = Array.isArray(data?.[1]) ? data[1] : [];
  if (vals.length === 0) throw new Error(`No World Bank data for ${country}:${indicator}`);

  return vals
    .filter((v) => v && v.value !== null && v.value !== undefined && Number.isFinite(Number(v.value)))
    .map((v) => ({
      provider: 'world_bank',
      country,
      indicator,
      timestamp: parseIsoDate(v.date, !String(v.date || '').includes('M')),
      value: Number(v.value),
      source: 'worldbank',
    }));
}

module.exports = {
  fetchFredLatest,
  fetchWorldBankLatest,
  fetchFredHistory,
  fetchWorldBankHistory,
};