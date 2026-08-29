// utils.js — thin coordination barrel for CLI helpers.
// Target design: no heavy deps at top level.
// [REWRITE] — heavy universe helpers move to data_utils.js

const path = require('node:path');
const fs   = require('node:fs');
const A    = require('#shared/ansi');

const {
  REPO_ROOT, STORAGE_DATA_DIR,
  DEFAULT_SNAPSHOT, DEFAULT_QUALITY_REPORT, DEFAULT_FEATURES,
  DEFAULT_MODEL_REPORT, DEFAULT_BACKTEST, DEFAULT_STATE_PATH,
  BACKEND_CANDIDATES, CLI_CANDIDATES,
} = require('#shared/paths');

const DEFAULT_HISTORY = path.join(REPO_ROOT, 'storage', 'data', 'cache');

function hasFlag(args, flag)          { return Array.isArray(args) && args.includes(flag); }
function optionValue(args, flag, fb)  { if (!Array.isArray(args)) return fb ?? null; const i = args.indexOf(flag); return i !== -1 && args[i+1] !== undefined ? args[i+1] : (fb ?? null); }
function numericOption(args, flag, fb){ const v = Number(optionValue(args, flag, fb)); return Number.isFinite(v) ? v : (fb ?? 0); }

function safeReadJson(fp) {
  try { return fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, 'utf8')) : null; } catch { return null; }
}

function shouldAnimate(args = []) {
  return process.stdout.isTTY && !hasFlag(args, '--json') && !hasFlag(args, '--quiet');
}

async function withLoadingAnimation(label, task, args = [], options = {}) {
  const enabled = options.enabled !== undefined ? options.enabled : shouldAnimate(args);
  if (!enabled) return task();
  const frames = ['|', '/', '-', '\\'];
  let i = 0, stopped = false;
  process.stdout.write(`\r\x1b[2K${label} ${frames[0]}`);
  const timer = setInterval(() => { if (!stopped) process.stdout.write(`\r\x1b[2K${label} ${frames[i++ % frames.length]}`); }, 80);
  if (timer.unref) timer.unref();
  try { return await task(); }
  finally { stopped = true; clearInterval(timer); process.stdout.write('\r\x1b[2K'); }
}

const {
  runInteractiveMenu, handleIntersection,
  promptSelect, promptText, promptConfirm, promptMultiSelect, isRichTerminal,
} = require('../tui');

function labelState(ok, neg = false) { return (!ok || neg) ? 'warn' : 'ok'; }
function printPayload(p, args = [])  { if (hasFlag(args, '--json')) { console.log(JSON.stringify(p, null, 2)); return; } console.log(p); }
function formatHumanNumber(v)        { if (typeof v !== 'number' || !Number.isFinite(v)) return v; return Number.isInteger(v) ? v : parseFloat(v.toPrecision(6)); }
function renderHumanValue(v)         { if (v == null) return '-'; if (typeof v === 'boolean') return v ? 'yes' : 'no'; return String(v); }
function formatHumanPayload(p)       { return p; }

function buildStatusLine(authEmail) {
  const backendOk = BACKEND_CANDIDATES.some(c => fs.existsSync(c));
  const cacheOk   = fs.existsSync(DEFAULT_SNAPSHOT);
  const bL = backendOk ? A.c(A.GREEN, 'OK') : A.c(A.RED, 'Missing');
  const cL = cacheOk   ? A.c(A.GREEN, 'Valid') : A.c(A.YELLOW, 'Empty');
  const au = authEmail ? `${A.muted(' | ')}${A.c(A.GREEN, '●')} ${A.muted(authEmail)}` : `${A.muted(' | ')}${A.c(A.YELLOW, '○')} ${A.muted('Not signed in')}`;
  return `${A.muted('Backend: ')}${bL}${A.muted(' | Cache: ')}${cL}${au}`;
}

function currentPhaseLabel() {
  try { const t = fs.readFileSync(DEFAULT_STATE_PATH, 'utf8'); const m = t.match(/^## Current Phase\r?\n([^\r\n]+)/m); return m ? m[1].trim() : 'Unknown phase'; }
  catch { return 'Unknown phase'; }
}

function get_Current_Universe_Symbols() {
  try {
    if (!fs.existsSync(DEFAULT_HISTORY)) return [];
    const out = [], seen = new Set();
    for (const family of fs.readdirSync(DEFAULT_HISTORY)) {
      const hp = path.join(DEFAULT_HISTORY, family, 'backtest_history.json');
      if (!fs.existsSync(hp)) continue;
      try {
        const data = JSON.parse(fs.readFileSync(hp, 'utf8'));
        for (const s of (data.sources || [])) {
          const sym = s.symbol || s.underlying || s.series || s.metric || s.event;
          if (!sym) continue;
          const key = `${s.family || family}:${sym}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ symbol: sym, family: s.family || family, market: s.config_market || null, sector: s.config_sector || null });
        }
      } catch {}
    }
    return out;
  } catch { return []; }
}

async function get_Full_Universe_Symbols() {
  // [REWRITE] move to data_utils.js with lazy ingest import
  return get_Current_Universe_Symbols();
}

function resolveSymbols(inputSymbols, universe = null) {
  if (!universe) universe = get_Current_Universe_Symbols();
  const syms = Array.isArray(inputSymbols) ? inputSymbols : String(inputSymbols||'').split(',').map(s=>s.trim()).filter(Boolean);
  return syms.map(s => {
    const up = s.toUpperCase();
    const exact = universe.find(u => String(u.symbol||'').toUpperCase() === up);
    if (exact) return exact.symbol;
    const fuzzy = universe.find(u => { const sy = String(u.symbol||'').toUpperCase(); return sy && (sy.startsWith(up)||sy.endsWith(up)); });
    return fuzzy ? fuzzy.symbol : up;
  });
}

const IS_DEBUG = process.argv.includes('--debug') || process.env.SOVEREIGN_DEBUG === 'true';
const logger = {
  debug: (...a) => { if (IS_DEBUG) console.log(A.c(A.CYAN, '[DEBUG]'), ...a); },
  info:  (...a) => console.log(...a),
  warn:  (...a) => console.warn(A.c(A.YELLOW, '[WARN]'), ...a),
  error: (...a) => console.error(A.c(A.RED, '[ERR]'), ...a),
};

function usage(name, desc) { return `${name}\n  ${desc}`; }
function helpText(...lines) { return lines.join('\n'); }
function pageText(text)     { console.log(text); }

const HELP_TOPICS = { overview: ['Sovereign CLI — see `sovereign --help`'] };

module.exports = {
  REPO_ROOT, STORAGE_DATA_DIR, DEFAULT_SNAPSHOT, DEFAULT_QUALITY_REPORT,
  DEFAULT_HISTORY, DEFAULT_FEATURES, DEFAULT_MODEL_REPORT, DEFAULT_BACKTEST,
  DEFAULT_STATE_PATH, BACKEND_CANDIDATES, CLI_CANDIDATES, HELP_TOPICS,
  hasFlag, optionValue, numericOption, safeReadJson,
  shouldAnimate, withLoadingAnimation,
  labelState, printPayload, formatHumanNumber, formatHumanPayload, renderHumanValue,
  buildStatusLine, currentPhaseLabel,
  get_Current_Universe_Symbols, get_Full_Universe_Symbols, resolveSymbols,
  logger, usage, helpText, pageText,
  runInteractiveMenu, handleIntersection,
  promptSelect, promptText, promptConfirm, promptMultiSelect, isRichTerminal,
};
