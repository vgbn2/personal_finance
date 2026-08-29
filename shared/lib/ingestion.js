const fs = require('node:fs/promises');
const path = require('node:path');
const {
  fetchBinanceBaseCandles,
  fetchYahooBaseCandles,
  fetchFrankfurterFx,
  fetchFredLatest,
  fetchWorldBankLatest,
  fetchKalshiPredictionEvent,
  fetchAlternativeMeFearGreed,
  fetchNasaPowerWeather,
  REPO_ROOT,
} = require('./providers');

const CACHE_PATH = path.join(REPO_ROOT, 'storage', 'data', 'cache', 'last_fetch.json');

/**
 * Validates whether a value is a finite number.
 */
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Safely parses any date/timestamp into a validated ISO-8601 string.
 * Handles ISO strings, Date objects, Unix timestamps in seconds or milliseconds,
 * and falls back to fallback or current time if unparseable.
 */
function normalizeIsoTimestamp(value, fallback = null) {
  if (!value && value !== 0) {
    return fallback || new Date().toISOString();
  }

  if (value instanceof Date) {
    return !Number.isNaN(value.getTime()) ? value.toISOString() : (fallback || new Date().toISOString());
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) {
      return fallback || new Date().toISOString();
    }
    // If value is in seconds (e.g. < 1e11), convert to milliseconds
    const ms = value < 1e11 ? value * 1000 : value;
    const date = new Date(ms);
    return !Number.isNaN(date.getTime()) ? date.toISOString() : (fallback || new Date().toISOString());
  }

  const str = String(value).trim();
  if (!str) return fallback || new Date().toISOString();

  // If numeric string
  if (/^\d+(\.\d+)?$/.test(str)) {
    const num = Number(str);
    if (Number.isFinite(num) && num > 0) {
      const ms = num < 1e11 ? num * 1000 : num;
      const date = new Date(ms);
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
  }

  // If YYYYMMDD format
  if (/^\d{8}$/.test(str)) {
    const y = str.slice(0, 4);
    const m = str.slice(4, 6);
    const d = str.slice(6, 8);
    const date = new Date(`${y}-${m}-${d}T00:00:00.000Z`);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }

  const date = new Date(str.includes('T') ? str : (str.includes(' ') ? str.replace(' ', 'T') + 'Z' : `${str}T00:00:00.000Z`));
  if (!Number.isNaN(date.getTime())) {
    return date.toISOString();
  }

  return fallback || new Date().toISOString();
}

/**
 * Retries an asynchronous operation with exponential backoff and rate limit handling.
 */
async function withRetry(operation, options = {}) {
  const maxRetries = options.maxRetries ?? 3;
  const initialDelayMs = options.initialDelayMs ?? 200;
  const maxDelayMs = options.maxDelayMs ?? 4000;
  const backoffFactor = options.backoffFactor ?? 2;

  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      attempt++;
      if (attempt > maxRetries) {
        throw error;
      }

      const message = String(error?.message || '').toLowerCase();
      const status = error?.status || error?.statusCode || error?.response?.status;
      const isRateLimit = status === 429 || message.includes('429') || message.includes('rate limit') || message.includes('too many requests');
      const isTransient = isRateLimit ||
        status === 500 || status === 502 || status === 503 || status === 504 ||
        message.includes('econnreset') || message.includes('etimedout') ||
        message.includes('enotfound') || message.includes('socket hang up') ||
        message.includes('fetch failed') || message.includes('network');

      if (!isTransient && options.retryAll !== true) {
        throw error;
      }

      // If rate limited, use higher backoff delay
      const baseDelay = isRateLimit ? Math.max(initialDelayMs * 2, 1000) : initialDelayMs;
      const delay = Math.min(maxDelayMs, baseDelay * Math.pow(backoffFactor, attempt - 1)) + Math.random() * 100;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * Extracts target items from configuration section regardless of key naming.
 */
function safeGetSectionItems(section) {
  if (!section || typeof section !== 'object') return ['default'];
  const candidates = [
    section.symbols,
    section.series,
    section.countries,
    section.locations,
    section.chains,
    section.events,
    section.underlyings,
    section.metrics,
    section.fields,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      return candidate.filter(Boolean);
    }
  }
  return ['default'];
}

/**
 * Manifest defining fetchers per family for batch ingestion.
 */
const FAMILIES_MANIFEST = [
  {
    id: 'equities',
    fetcher: async (p, s, t, cfg, opts) => fetchYahooBaseCandles(s, t || '1d'),
  },
  {
    id: 'indices',
    fetcher: async (p, s, t, cfg, opts) => fetchYahooBaseCandles(s, t || '1d'),
  },
  {
    id: 'commodities',
    fetcher: async (p, s, t, cfg, opts) => fetchYahooBaseCandles(s, t || '1d'),
  },
  {
    id: 'crypto',
    fetcher: async (p, s, t, cfg, opts) => fetchBinanceBaseCandles(s, 1000, t || '1d'),
  },
  {
    id: 'fx',
    fetcher: async (p, s, t, cfg, opts) => [await fetchFrankfurterFx(s)],
  },
  {
    id: 'macro',
    fetcher: async (p, s, t, cfg, opts) => {
      const seriesId = cfg?.fred_mappings?.macro?.[s] || s;
      return [await fetchFredLatest(seriesId)];
    },
  },
  {
    id: 'sentiment',
    fetcher: async (p, s, t, cfg, opts) => [await fetchAlternativeMeFearGreed()],
  },
  {
    id: 'reserves',
    fetcher: async (p, s, t, cfg, opts) => {
      const indicator = cfg?.world_bank_mappings?.[opts?.metric] || 'FI.RES.TOTL.CD';
      return [await fetchWorldBankLatest(s, indicator)];
    },
  },
  {
    id: 'prediction_market',
    fetcher: async (p, s, t, cfg, opts) => {
      const res = await fetchKalshiPredictionEvent(s);
      return res ? [res] : [];
    },
  },
  {
    id: 'weather',
    fetcher: async (p, s, t, cfg, opts) => {
      if (typeof fetchNasaPowerWeather === 'function') {
        return [await fetchNasaPowerWeather(s)];
      }
      return [];
    },
  },
];

/**
 * Runs a batch ingestion across configured families with defensive guards.
 */
async function runIngestBatch(config = {}, options = {}) {
  const snapshot = {
    mode: options.mode || 'live',
    fetched_at: new Date().toISOString(),
    sources: [],
    errors: [],
    provider_checks: [],
  };

  const safeConfig = config && typeof config === 'object' ? config : {};

  for (const family of FAMILIES_MANIFEST) {
    if (options.family && options.family !== family.id) continue;

    const section = safeConfig.sources?.[family.id] || safeConfig[family.id];
    if (!section || !section.enabled) continue;

    const providers = Array.isArray(section.providers) && section.providers.length > 0
      ? section.providers.filter(Boolean)
      : ['default'];
    const primaryProvider = providers[0] || 'default';
    const items = safeGetSectionItems(section);
    const targetItems = options.symbol ? items.filter((i) => i === options.symbol) : items;
    const timeframe = section.timeframes?.[0] || options.timeframe || '1d';

    for (const item of targetItems) {
      try {
        const rawRecords = await withRetry(
          () => family.fetcher(primaryProvider, item, timeframe, safeConfig, options),
          { maxRetries: options.maxRetries ?? 2 }
        );

        const recordList = Array.isArray(rawRecords) ? rawRecords : (rawRecords ? [rawRecords] : []);
        const validRecords = recordList
          .filter((r) => r && typeof r === 'object')
          .map((r) => {
            const normalizedTs = normalizeIsoTimestamp(r.timestamp || r.openTime || r.observed_at || r.date);
            const copy = {
              ...r,
              family: r.family || family.id,
              symbol: r.symbol || r.series || r.location || r.country || item,
              timestamp: normalizedTs,
            };
            if (Number.isFinite(r.openTime)) copy.openTime = Number(r.openTime);
            if (Number.isFinite(r.open)) copy.open = Number(r.open);
            if (Number.isFinite(r.high)) copy.high = Number(r.high);
            if (Number.isFinite(r.low)) copy.low = Number(r.low);
            if (Number.isFinite(r.close)) copy.close = Number(r.close);
            if (Number.isFinite(r.volume)) copy.volume = Number(r.volume);
            if (Number.isFinite(r.value)) copy.value = Number(r.value);
            return copy;
          });

        if (validRecords.length > 0) {
          snapshot.sources.push(...validRecords);
          snapshot.provider_checks.push({
            family: family.id,
            provider: primaryProvider,
            symbol: item,
            status: 'ok',
            records: validRecords.length,
          });
        } else {
          snapshot.provider_checks.push({
            family: family.id,
            provider: primaryProvider,
            symbol: item,
            status: 'skipped',
            reason: 'empty_payload',
          });
        }
      } catch (e) {
        snapshot.errors.push({
          family: family.id,
          provider: primaryProvider,
          symbol: item,
          message: e.message || String(e),
          status: 'error',
        });
        snapshot.provider_checks.push({
          family: family.id,
          provider: primaryProvider,
          symbol: item,
          status: 'error',
          message: e.message || String(e),
        });
      }
    }
  }

  return snapshot;
}

module.exports = {
  CACHE_PATH,
  FAMILIES_MANIFEST,
  runIngestBatch,
  normalizeIsoTimestamp,
  withRetry,
  isFiniteNumber,
  safeGetSectionItems,
};
