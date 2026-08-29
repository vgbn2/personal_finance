/**
 * MCP Gate — controls which API routes and data fields are visible to
 * external AI agents (Claude Code MCP tools, Gemini) accessing via MCP.
 *
 * Rule: read-only market/research data is safe. Auth, credentials,
 * broker config, kill-switch, and raw DB access are blocked.
 *
 * Detection: set MCP_GATE_TOKEN in .env and configure your MCP client
 * to send header  x-mcp-token: <value>  on every request.
 * For Claude Code, add to .mcp.json:
 *   "headers": { "x-mcp-token": "<your-MCP_GATE_TOKEN-value>" }
 */

const ALLOWED_ROUTES = new Set([
  '/health',
  '/api/status',
  '/api/data/summary',
  '/api/analytics',
  '/api/backtest',
  '/api/correlation',
  '/api/backend/stats',
  '/api/backend/portfolio',
  '/api/universe',
  '/api/cache/universe',
  '/api/indicators',
  '/api/quotes/status',
  '/api/signal',
  '/api/system/status',
  '/api/strategies',
]);

// Routes the MCP agent must NEVER touch
const BLOCKED_ROUTES = new Set([
  '/api/auth/status',
  '/api/auth/login',
  '/api/auth/register',
  '/api/database/status',
  '/api/supabase/config',
  '/api/kill-switch',
  '/api/config',
  '/api/cache/list',
  '/api/signal/promote',
]);

const SENSITIVE_KEY_RE = /password|token|secret|credential|api_key|auth|private|seed|vault/i;

function redactDeep(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(redactDeep);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = SENSITIVE_KEY_RE.test(k) ? '[REDACTED]' : redactDeep(v);
  }
  return out;
}

const MCP_GATE_TOKEN = process.env.MCP_GATE_TOKEN || '';

function isMcpRequest(req) {
  // Token-based: preferred — set MCP_GATE_TOKEN in .env and send x-mcp-token header from MCP client
  if (MCP_GATE_TOKEN && req.headers['x-mcp-token'] === MCP_GATE_TOKEN) return true;
  // Fallback: well-known MCP client headers (Ollama agent, generic MCP clients)
  return (
    req.headers['x-mcp-agent'] === '1' ||
    req.headers['x-mcp-client'] != null ||
    (req.headers['user-agent'] || '').toLowerCase().includes('mcp-')
  );
}

function isMcpAllowed(pathname) {
  const base = pathname.split('?')[0].replace(/\/$/, '') || '/';
  if (BLOCKED_ROUTES.has(base)) return false;
  for (const allowed of ALLOWED_ROUTES) {
    if (base === allowed || base.startsWith(allowed + '/')) return true;
  }
  return false;
}

module.exports = { ALLOWED_ROUTES, BLOCKED_ROUTES, isMcpRequest, isMcpAllowed, redactDeep };
