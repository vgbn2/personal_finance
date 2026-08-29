const { ask } = require('./ai_client');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { REPO_ROOT } = require('./paths');

const CLI = path.join(REPO_ROOT, 'backend', 'cli', 'sovereign_cli.js');

function runCli(args, timeoutMs = 60000) {
  const result = spawnSync(
    process.execPath,
    [CLI, ...args, '--json'],
    { cwd: REPO_ROOT, encoding: 'utf8', timeout: timeoutMs }
  );
  if (result.error) throw result.error;
  const raw = result.stdout || '';
  try {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start !== -1 && end !== -1) return JSON.parse(raw.slice(start, end + 1));
  } catch {}
  return { raw: raw.trim(), stderr: result.stderr?.trim() };
}

const TOOLS = {
  backfill_all: {
    description: 'Backfill all symbols and timeframes with market data',
    args: { timeframes: '1h,4h,1d', days: 90, concurrency: 5, dry_run: false }
  },
  get_price: {
    description: 'Get latest price and stats for a symbol',
    args: { symbol: 'e.g., BTCUSDT', timeframe: '1d' }
  },
  run_backtest: {
    description: 'Run backtest for a strategy on a symbol',
    args: { symbol: 'e.g., BTCUSDT', strategy: 'e.g., mean_reversion', days: 365, timeframe: '1d' }
  },
  edge_decay: {
    description: 'Check if a strategy alpha is decaying across rolling time windows (30d/90d/180d/365d/full)',
    args: { strategy: 'e.g., mean_reversion', symbol: 'e.g., BTCUSDT', timeframe: '1d' }
  },
  get_data_summary: {
    description: 'Get data availability and freshness summary',
    args: {}
  },
  validate_strategy: {
    description: 'Validate a strategy YAML file',
    args: { strategy_name: 'e.g., mean_reversion' }
  },
  get_system_status: {
    description: 'Get Sovereign system health, phase, and C++ core status',
    args: {}
  }
};

function formatToolsForPrompt() {
  return Object.entries(TOOLS).map(([name, info]) =>
    `- ${name}: ${info.description}\n  Args: ${JSON.stringify(info.args)}`
  ).join('\n');
}

function parseToolCalls(text) {
  const calls = [];
  const regex = /\[TOOL_CALL\]\s*(\{[\s\S]*?\})\s*\[\/TOOL_CALL\]/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    try { calls.push(JSON.parse(match[1])); } catch {}
  }
  return calls;
}

async function executeTool(toolName, args) {
  process.stdout.write(`[EXEC] ${toolName}(${JSON.stringify(args)})\n`);

  switch (toolName) {
    case 'backfill_all': {
      const cliArgs = ['mass-backfill'];
      if (args.timeframes) cliArgs.push('--timeframes', args.timeframes);
      if (args.days)       cliArgs.push('--days', String(args.days));
      if (args.concurrency) cliArgs.push('--concurrency', String(args.concurrency));
      if (args.dry_run)    cliArgs.push('--dry-run');
      return runCli(cliArgs, 300000);
    }
    case 'get_price': {
      return runCli(['backend', 'price', args.symbol || 'BTCUSDT',
        '--timeframe', args.timeframe || '1d']);
    }
    case 'run_backtest': {
      const stratName = (args.strategy || 'mean_reversion').replace(/\.yaml$/i, '');
      const cliArgs = ['backtest', args.symbol || 'BTCUSDT',
        '--strategy', `config/strategies/${stratName}.yaml`,
        '--timeframe', args.timeframe || '1d',
        '--days', String(args.days || 365)];
      return runCli(cliArgs, 120000);
    }
    case 'get_data_summary': {
      return runCli(['backend', 'integrity']);
    }
    case 'edge_decay': {
      const cliArgs = ['edge-decay', '--json'];
      if (args.strategy) {
        const name = args.strategy.replace(/\.yaml$/i, '');
        cliArgs.push('--strategy', `config/strategies/${name}.yaml`);
      }
      if (args.symbol)    cliArgs.push('--symbol', args.symbol);
      if (args.timeframe) cliArgs.push('--timeframe', args.timeframe);
      return runCli(cliArgs, 120000);
    }
    case 'validate_strategy': {
      return runCli(['strategy', 'validate',
        `config/strategies/${args.strategy_name || 'mean_reversion'}.yaml`]);
    }
    case 'get_system_status': {
      return runCli(['status']);
    }
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

function slimResult(toolName, result) {
  if (!result || typeof result !== 'object') return result;
  switch (toolName) {
    case 'run_backtest': {
      const m = result.metrics || result.out_of_sample || {};
      return {
        sharpe: m.sharpe_ratio,
        net_return: m.net_return,
        win_rate: m.win_rate,
        max_drawdown: m.max_drawdown,
        trades: m.trades,
        verdict: result.trust_assessment?.verdict,
        oos_sharpe: result.out_of_sample?.sharpe_ratio,
      };
    }
    case 'edge_decay':
      return {
        decay_score: result.decay_score,
        verdict: result.verdict,
        windows: (result.windows || []).map(w => ({
          window: w.window, sharpe: w.sharpe, net_return: w.net_return
        })),
      };
    case 'get_price':
      return {
        symbol: result.symbol,
        close: result.close,
        change_pct: result.change_pct,
        volume: result.volume,
        timeframe: result.timeframe,
      };
    case 'backfill_all':
      return {
        completed: result.completed,
        failed: result.failed,
        total_bars: result.total_bars,
        status: result.status,
      };
    case 'get_data_summary':
      return {
        symbols_count: result.symbols_count ?? result.total_symbols,
        freshness_ok: result.freshness_ok,
        stale_count: result.stale_count,
        status: result.status,
      };
    case 'get_system_status':
      return {
        phase: result.phase,
        status: result.status,
        cache_ok: result.cache_ok,
        version: result.version,
      };
    default:
      return result;
  }
}

async function agentLoop(userQuery, maxIterations = 5) {
  const toolsDesc = formatToolsForPrompt();
  const systemPrompt = `You are an AI agent for the Sovereign trading platform. You can invoke real tools on the platform.

Available tools:
${toolsDesc}

To invoke a tool, output EXACTLY this format (no extra text around the block):
[TOOL_CALL]
{
  "tool": "tool_name",
  "args": { "arg1": "value1" }
}
[/TOOL_CALL]

After receiving tool results, interpret them and respond to the user. Only invoke tools when necessary.`;

  const conversation = [{ role: 'user', content: userQuery }];
  let iteration = 0;

  while (iteration < maxIterations) {
    iteration++;
    process.stdout.write(`\n[ITER ${iteration}/${maxIterations}] Querying Ollama...\n`);

    const currentPrompt = conversation.map(m => `${m.role}: ${m.content}`).join('\n\n');
    const response = await ask(currentPrompt, systemPrompt);

    if (!response) return { error: 'Ollama unavailable' };

    process.stdout.write(`[OLLAMA] ${response.text.slice(0, 300)}\n`);
    conversation.push({ role: 'assistant', content: response.text });

    const toolCalls = parseToolCalls(response.text);
    if (toolCalls.length === 0) {
      return { status: 'ok', response: response.text, iterations: iteration };
    }

    const toolResults = [];
    for (const call of toolCalls) {
      try {
        const result = await executeTool(call.tool, call.args || {});
        toolResults.push({ tool: call.tool, result: slimResult(call.tool, result), status: 'ok' });
      } catch (e) {
        toolResults.push({ tool: call.tool, error: e.message, status: 'error' });
      }
    }

    process.stdout.write(`[RESULTS] ${toolResults.length} tool(s) executed\n`);
    conversation.push({
      role: 'user',
      content: `Tool results:\n${JSON.stringify(toolResults, null, 2)}\n\nContinue helping the user.`
    });
  }

  return { error: `Max iterations (${maxIterations}) reached`, last_response: conversation.at(-1)?.content };
}

module.exports = { agentLoop, parseToolCalls, executeTool };
