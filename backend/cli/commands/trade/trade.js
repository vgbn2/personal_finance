const path = require('node:path');
const A = require('#shared/ansi');
const { verifyPin, requireAuth } = require('../../lib/auth.js');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const { calculateRollingFeatureFrame, DEFAULT_PERIODS } = require('#shared/indicators');
const { readSnapshot, validateSnapshot } = require('#shared/market_validation');
const utils = require('../../lib/utils.js');
const { DEFAULT_SNAPSHOT } = utils;
const {
  pageText,
  promptSelect,
  promptText,
  promptConfirm,
  isRichTerminal,
  currentPhaseLabel,
  hasFlag,
  optionValue,
  printPayload,
} = utils;

/**
 * Builds the launch configuration for the execution gateway.
 * @param {string[]} args Command line arguments.
 * @returns {object} Launch object with command and args.
 */
function buildTradeGatewayLaunch(args = []) {
  const gatewayPath = path.join(utils.REPO_ROOT, 'backend', 'gateway', 'src', 'index.ts');
  const tsxCandidates = [
    path.join(utils.REPO_ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx'),
    path.join(utils.REPO_ROOT, 'backend', 'gateway', 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx'),
  ];
  const tsxPath = tsxCandidates.find((candidate) => fs.existsSync(candidate));
  if (tsxPath) {
    if (process.platform === 'win32' && tsxPath.toLowerCase().endsWith('.cmd')) {
      const quoteForPowerShell = (value) => `'${String(value).replace(/'/g, "''")}'`;
      return { 
        command: 'powershell.exe', 
        args: ['-NoProfile', '-Command', `& ${[tsxPath, gatewayPath, ...args].map(quoteForPowerShell).join(' ')}`],
        shell: false
      };
    }
    return { command: tsxPath, args: [gatewayPath, ...args], shell: false };
  }
  if (process.platform === 'win32') {
    return { command: 'cmd.exe', args: ['/c', 'npx', 'tsx', gatewayPath, ...args], shell: false };
  }
  return { command: 'npx', args: ['tsx', gatewayPath, ...args], shell: false };
}

/**
 * Returns the help text for the Trade Desk.
 */
function tradeDeskText() {
  return [
    A.B_CYAN + 'Sovereign Trade Desk' + A.RESET,
    A.GRAY + '='.repeat(72) + A.RESET,
    `  Phase: ${currentPhaseLabel()}`,
    '  Mode: dry-run by default; use --live only when you mean it',
    '  Actions: balance | buy | sell | process',
    '  Tip: plain `trade` opens the guided desk on an interactive terminal',
    '',
    '  Examples:',
    '    trade balance',
    '    trade buy    AAPL 10 market',
    '    trade sell TSLA 5 limit 180 --live',
    '    trade process proposed_orders.json',
  ].join('\n');
}

function maskLogin(login) {
  const text = String(login || '').trim();
  if (!text) return 'n/a';
  if (text.length <= 4) return '*'.repeat(text.length);
  return text.replace(/^(.{2}).*(.{2})$/, '$1***$2');
}

function inspectMt5Setup(slot, profile, terminalPath, bridgeInstalled) {
  const checks = [
    {
      key: 'profile',
      ok: Boolean(profile),
      label: 'Saved profile',
      detail: profile ? `${profile.label || slot} | ${profile.server || 'server missing'}` : 'No saved MT5 profile for this slot',
    },
    {
      key: 'login',
      ok: Boolean(profile && profile.login),
      label: 'Login ID',
      detail: profile && profile.login ? maskLogin(profile.login) : 'Missing login ID',
    },
    {
      key: 'server',
      ok: Boolean(profile && profile.server),
      label: 'Server',
      detail: profile && profile.server ? profile.server : 'Missing MT5 server',
    },
    {
      key: 'password',
      ok: Boolean(profile && profile.has_password),
      label: 'Password',
      detail: profile && profile.has_password ? 'Encrypted secret stored' : 'No encrypted password saved',
    },
    {
      key: 'terminal',
      ok: Boolean(terminalPath && fs.existsSync(terminalPath)),
      label: 'Terminal',
      detail: terminalPath && fs.existsSync(terminalPath)
        ? terminalPath
        : 'terminal64.exe not found; set SOVEREIGN_MT5_TERMINAL_PATH or save terminal_path in the profile',
    },
    {
      key: 'bridge',
      ok: Boolean(bridgeInstalled),
      label: 'EA bridge installer',
      detail: bridgeInstalled
        ? path.join(utils.REPO_ROOT, 'backend', 'scripts', 'verification', 'mt5_bridge_install.js')
        : 'Bridge installer script is missing',
    },
  ];

  const ready = checks.every((check) => check.ok);
  const failing = checks.filter((check) => !check.ok).map((check) => check.label);
  return {
    ok: ready,
    type: 'mt5_diagnostics',
    slot,
    login: profile && profile.login ? maskLogin(profile.login) : null,
    server: profile && profile.server ? profile.server : null,
    terminal: terminalPath || '',
    checks,
    next_action: ready
      ? 'Run `sovereign mt5 connect --slot <slot>` to launch MetaTrader with this profile.'
      : `Fix: ${failing.join(', ')}`,
  };
}

function renderMt5Diagnostics(report) {
  const lines = [
    A.B_CYAN + 'MT5 Doctor' + A.RESET,
    A.GRAY + '='.repeat(72) + A.RESET,
    `  Slot: ${report.slot || 'n/a'}`,
  ];
  if (report.login) lines.push(`  Login: ${report.login}`);
  if (report.server) lines.push(`  Server: ${report.server}`);
  lines.push('');
  report.checks.forEach((check) => {
    const status = check.ok ? A.GREEN + 'OK' + A.RESET : A.RED + 'FAIL' + A.RESET;
    lines.push(`  [${status}] ${check.label}`);
    lines.push(`      ${check.detail}`);
  });
  lines.push('');
  lines.push(`  Next: ${report.next_action}`);
  return lines.join('\n');
}

function renderMt5ProfileList(profiles) {
  const lines = [
    A.B_CYAN + 'MT5 Profiles' + A.RESET,
    A.GRAY + '='.repeat(72) + A.RESET,
  ];
  profiles.forEach((profile) => {
    lines.push(`  ${profile.label || profile.slot} | login ${maskLogin(profile.login)} | ${profile.server || 'server missing'} | password ${profile.has_password ? 'saved' : 'missing'}`);
  });
  return lines.join('\n');
}

/**
 * Interactively prompts for trade arguments.
 */
async function promptTradeDeskArgs() {
  global.suppressLogs = true;
  process.stdout.write(A.CLR_ALL + A.HOME);

  const action = await promptSelect('Trade desk action:', [
    { label: 'Balance snapshot', value: 'balance' },
    { label: 'Aggregate Live & Paper Portfolio', value: 'aggregate_portfolio' },
    { label: 'Buy order', value: 'buy' },
    { label: 'Sell order', value: 'sell' },
    { label: 'Sigma band visualizer', value: 'visualize' },
    { label: 'Process proposed orders file', value: 'process' },
    { label: 'Cancel', value: 'cancel' },
  ]);

  global.suppressLogs = false;

  if (action === 'cancel') {
    return null;
  }
  if (action === 'balance' || action === 'aggregate_portfolio') {
    return [action];
  }
  if (action === 'visualize') {
    const symbol = String(await promptText('Symbol to visualize:', 'AAPL')).toUpperCase();
    return ['visualize', symbol];
  }
  if (action === 'process') {
    const filePath = await promptText('Orders file path:', 'proposed_orders.json');
    const live = await promptConfirm('Execute live orders from file?');
    return ['process', filePath, ...(live ? ['--live'] : [])];
  }

  const symbol = String(await promptText('Symbol:', 'AAPL')).toUpperCase();
  const qty = await promptText('Quantity:', '1');

  const orderType = await promptSelect('Order type:', [
    { label: 'Market', value: 'market' },
    { label: 'Limit', value: 'limit' },
  ]);
  const commandArgs = [action, symbol, qty, orderType];
  if (orderType === 'limit') {
    const price = await promptText('Limit price:', '');
    if (price) {
      commandArgs.push(price);
    }
  }
  const live = await promptConfirm('Execute live order?');
  console.log([
    '',
    A.BOLD + 'Order Preview' + A.RESET,
    `  side=${action}`,
    `  symbol=${symbol}`,
    `  qty=${qty}`,
    `  type=${orderType}`,
    ...(orderType === 'limit' && commandArgs[4] ? [`  price=${commandArgs[4]}`] : []),
    `  mode=${live ? 'LIVE' : 'DRY-RUN'}`,
    '',
  ].join('\n'));
  const proceed = await promptConfirm('Send this order to the gateway?');
  if (!proceed) {
    return null;
  }
  if (live) {
    commandArgs.push('--live');
  }
  return commandArgs;
}

/**
 * Fetches the current portfolio balance from the gateway.
 */
async function fetchBalance(live = false) {
  const launch = buildTradeGatewayLaunch(['balance', ...(live ? ['--live'] : []), '--json']);
  const result = spawnSync(launch.command, launch.args, {
    cwd: utils.REPO_ROOT,
    encoding: 'utf8',
    shell: launch.shell ?? false,
  });

  if (result.error) {
    throw new Error(`Failed to fetch balance: ${result.error.message}`);
  }

  try {
    // Filter out potential non-JSON logs from the output
    const lines = result.stdout.split('\n');
    const jsonLine = lines.find(l => l.trim().startsWith('{') && l.trim().endsWith('}'));
    if (!jsonLine) throw new Error('No JSON balance found in gateway output');
    return JSON.parse(jsonLine);
  } catch (err) {
    console.error(`[TRADE] Raw output: ${result.stdout}`);
    throw new Error(`Failed to parse balance JSON: ${err.message}`);
  }
}

/**
 * Fetches the aggregated multi-broker portfolio from the gateway.
 */
async function fetchAggregatePortfolio() {
  const launch = buildTradeGatewayLaunch(['aggregate_portfolio', '--json']);
  const result = spawnSync(launch.command, launch.args, {
    cwd: utils.REPO_ROOT,
    encoding: 'utf8',
    shell: launch.shell ?? false,
  });

  if (result.error) {
    throw new Error(`Failed to fetch aggregated portfolio: ${result.error.message}`);
  }

  try {
    const lines = result.stdout.split('\n');
    const jsonLine = lines.find(l => l.trim().startsWith('{') && l.trim().endsWith('}'));
    if (!jsonLine) throw new Error('No JSON portfolio found in gateway output');
    return JSON.parse(jsonLine);
  } catch (err) {
    console.error(`[TRADE] Raw output: ${result.stdout}`);
    throw new Error(`Failed to parse portfolio JSON: ${err.message}`);
  }
}


/**
 * Handles the 'polymarket' command.
 * Sub: portfolio, markets, derive-creds
 */
async function commandPolymarket(args) {
  const sub = args[0] || 'portfolio';
  const gatewayArgs = ['polymarket', sub, ...args.slice(1)];
  if (hasFlag(args, '--json')) gatewayArgs.push('--json');

  const launch = buildTradeGatewayLaunch(gatewayArgs);
  const result = spawnSync(launch.command, launch.args, {
    cwd: utils.REPO_ROOT,
    stdio: 'inherit',
    shell: launch.shell ?? false,
  });
  return result.status ?? 0;
}

/**
 * Handles the 'trade' command.
 */
async function commandTrade(args) {
  const subcommand = args[0];
  
  if (subcommand === 'balance' && hasFlag(args, '--json')) {
      try {
          const balance = await fetchBalance(hasFlag(args, '--live'));
          console.log(JSON.stringify(balance, null, 2));
          return 0;
      } catch (err) {
          console.error(`[ERROR] ${err.message}`);
          return 1;
      }
  }

  if (subcommand === 'aggregate_portfolio' && hasFlag(args, '--json')) {
    try {
        const portfolio = await fetchAggregatePortfolio();
        console.log(JSON.stringify(portfolio, null, 2));
        return 0;
    } catch (err) {
        console.error(`[ERROR] ${err.message}`);
        return 1;
    }
  }

  if (subcommand === 'visualize') {
    const symbol = args[1] || 'AAPL';
    console.log(`\n${A.B_CYAN}Visualizing Sigma Bands for ${symbol}${A.RESET}`);

    // Load real data
    const snapshot = readSnapshot(DEFAULT_SNAPSHOT);
    const sources = snapshot.sources.filter(s => s.symbol === symbol);

    if (sources.length < 20) {
        console.error(`${A.B_RED}[ERROR] Insufficient data for ${symbol} (found ${sources.length} bars, need 20+)${A.RESET}`);
        return 1;
    }

    const periods = { ...DEFAULT_PERIODS, volatility: 20 };
    const featureFrame = calculateRollingFeatureFrame(sources, 2, periods);

    if (!featureFrame.features || featureFrame.features.length === 0) {
        console.error(`${A.B_RED}[ERROR] Failed to calculate features for ${symbol}.${A.RESET}`);
        return 1;
    }

    const latest = featureFrame.features[featureFrame.features.length - 1];
    const currentPrice = latest.close;
    // Feature frame volatility is often annualized or pct, we need the raw stddev of price.
    // For now, we'll calculate a simple window mean/stddev here to be precise for the chart.
    const window = sources.slice(-20).map(s => s.close);
    const mean = window.reduce((a, b) => a + b, 0) / window.length;
    const stddev = Math.sqrt(window.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b, 0) / window.length);
    
    const { renderSigmaSparkline } = require('../../tui/index.js');
    console.log(`Current: ${currentPrice.toFixed(2)} | Mean: ${mean.toFixed(2)} | StdDev: ${stddev.toFixed(2)}`);
    console.log(renderSigmaSparkline(mean, stddev, currentPrice));
    return 0;
  }

  if (args.length === 0) {
    pageText(tradeDeskText(), []);
    if (!isRichTerminal()) {
      return 0;
    }
    const promptedArgs = await promptTradeDeskArgs();
    if (!promptedArgs) {
      console.log('Trade desk cancelled.');
      return 0;
    }
    args = promptedArgs;
  }

  if (hasFlag(args, '--live') && !(await requireAuth('live trading'))) return 1;

 
  if (hasFlag(args, '--live')) {
    const expectedPin = process.env.SOVEREIGN_TRADE_PIN;
    const providedPin = optionValue(args, '--pin', null);
    
    if (expectedPin) {
      let inputPin = providedPin;
      
      // If no PIN provided via flag and we have a terminal, prompt for it
      if (!inputPin && isRichTerminal()) {
        inputPin = await promptText('Enter Trade PIN to confirm LIVE execution:', '');
      }
      
      if (!verifyPin(inputPin, expectedPin)) {
        console.error(`${A.B_RED}[ERROR] Invalid or missing Trade PIN. LIVE execution blocked.${A.RESET}`);
        if (!isRichTerminal() && !providedPin) {
            console.error(`${A.GRAY}(Tip: For automated execution, set SOVEREIGN_TRADE_PIN and pass --pin <val> or ensure the environment is trusted.)${A.RESET}`);
        }
        return 1;
      }
      console.log(`${A.B_GREEN}[AUTH] PIN verified. Proceeding with LIVE trade...${A.RESET}`);
    } else {
      if (isRichTerminal()) {
        console.warn(`${A.B_YELLOW}[WARNING] SOVEREIGN_TRADE_PIN not set. LIVE trade proceeding without MFA gate.${A.RESET}`);
        const finalProceed = await promptConfirm('Confirm LIVE execution WITHOUT PIN?');
        if (!finalProceed) return 0;
      } else {
        // In non-interactive mode without a PIN set, we FAIL CLOSED for safety.
        console.error(`${A.B_RED}[ERROR] SOVEREIGN_TRADE_PIN not set. Unattended LIVE execution blocked (Fail-Closed).${A.RESET}`);
        return 1;
      }
    }
  }

  const launch = buildTradeGatewayLaunch(args);
  const result = spawnSync(launch.command, launch.args, {
    cwd: utils.REPO_ROOT,
    stdio: 'inherit',
    shell: launch.shell ?? false,
  });
  if (result.error) {
    console.error(`Trade gateway failed to start: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 0;
}

/**
 * MT5 sub-menu dispatcher — shown when user picks "MT5 / EA" from Execution.
 * Routes to profile management, connect, or bridge based on interactive choice.
 */
async function commandMt5(args) {
  if (args.length > 0) {
    const sub = args[0];
    if (sub === 'profile') return commandMt5Profile(args.slice(1));
    if (sub === 'connect') return commandMt5Connect(args.slice(1));
    if (sub === 'doctor' || sub === 'diag') return commandMt5Doctor(args.slice(1));
    if (sub === 'bridge') return commandMt5Bridge(args.slice(1));
  }

  global.suppressLogs = true;
  const action = await promptSelect('MT5 / EA:', [
    { label: 'List saved accounts', value: 'list' },
    { label: 'Add / Edit account  (login ID · server · password)', value: 'add' },
    { label: 'Doctor  (check profile, terminal, bridge)', value: 'doctor' },
    { label: 'Connect  (launch terminal with saved profile)', value: 'connect' },
    { label: 'Install EA Bridge  (SovereignExport.mq5)', value: 'bridge' },
    { label: 'Delete account profile', value: 'delete' },
  ]);
  global.suppressLogs = false;

  if (action === 'list') return commandMt5Profile(['list']);
  if (action === 'add') return commandMt5Profile(['add']);
  if (action === 'delete') return commandMt5Profile(['delete']);
  if (action === 'doctor') return commandMt5Doctor([]);
  if (action === 'connect') return commandMt5Connect([]);
  if (action === 'bridge') return commandMt5Bridge([]);
  return 0;
}

/**
 * Guided wizard to register a new broker or trading platform.
 * Supports REST API brokers (Alpaca-style), MT5 terminals, and custom/webhook setups.
 */
// does this actually works as intended? dev reiview
async function commandAddPlatform(args) {
  const { promptPassword } = require('../../lib/auth.js');
  const A = require('#shared/ansi');

  console.log(`\n${A.c(A.B_CYAN, 'SOVEREIGN')} ${A.muted('— Add Broker / Platform')}\n`);

  global.suppressLogs = true;
  const type = await promptSelect('Platform type:', [
    { label: 'Alpaca  (REST API — US stocks, crypto)', value: 'alpaca' },
    { label: 'MT5 / MetaTrader  (terminal — forex, CFDs, futures)', value: 'mt5' },
    { label: 'Other / Custom  (webhook, FIX, proprietary API)', value: 'custom' },
  ]);
  global.suppressLogs = false;

  if (type === 'mt5') {
    console.log(A.muted('\n  Launching MT5 profile setup...\n'));
    return commandMt5Profile(['add']);
  }

  if (type === 'alpaca') {
    console.log(A.muted('\n  Alpaca uses API keys stored in your .env file.'));
    console.log(A.muted('  Keys are NOT stored in the vault — keep your .env outside version control.\n'));
    global.suppressLogs = true;
    const key = await promptText('Alpaca API Key ID:', '');
    global.suppressLogs = false;
    if (!key) { console.error('API Key ID is required.'); return 1; }
    const secret = await promptPassword('Alpaca Secret Key');
    const mode = await promptSelect('Environment:', [
      { label: 'Paper trading (safe, simulated)', value: 'paper' },
      { label: 'Live trading (real money)', value: 'live' },
    ]);
    const envPath = path.join(utils.REPO_ROOT, '.env');
    const baseUrl = mode === 'paper'
      ? 'https://paper-api.alpaca.markets'
      : 'https://api.alpaca.markets';
    const block = [
      '',
      '# Alpaca broker',
      `ALPACA_API_KEY=${key}`,
      `ALPACA_SECRET_KEY=${secret}`,
      `ALPACA_BASE_URL=${baseUrl}`,
      '',
    ].join('\n');
    fs.appendFileSync(envPath, block, 'utf8');
    console.log(`\n${A.c(A.GREEN, '●')} Alpaca credentials appended to ${envPath}`);
    console.log(A.muted('  Run: sovereign trade balance  to verify the connection.'));
    return 0;
  }

  if (type === 'custom') {
    global.suppressLogs = true;
    const name = await promptText('Platform name:', '');
    global.suppressLogs = false;
    if (!name) { console.error('Platform name is required.'); return 1; }
    global.suppressLogs = true;
    const endpoint = await promptText('API endpoint or connection type:', '');
    global.suppressLogs = false;

    // Ask AI for setup guidance
    const { ask: aiAsk, isAvailable: aiAvailable } = require('#shared/ai_client');
    const aiReady = await aiAvailable();
    if (aiReady) {
      process.stdout.write(A.muted('\n  Asking AI for setup guidance...\n'));
      const system = 'You are a financial trading platform integration expert. Give concise, actionable setup steps for connecting a trading platform to a local trading system. Focus on: auth method, required credentials, API endpoints, and any known gotchas. Keep it under 10 bullet points.';
      const result = await aiAsk(`How do I connect "${name}" (${endpoint || 'unknown endpoint'}) to a local trading CLI? What credentials and configuration steps are needed?`, system);
      if (result) {
        console.log(`\n${A.c(A.B_CYAN, `AI Guidance`)} ${A.muted(`(via ${result.source})`)}`);
        console.log(A.muted('─'.repeat(60)));
        console.log(result.text);
        console.log(A.muted('─'.repeat(60)));
      }
    } else {
      console.log(A.muted('\n  Tip: run `ollama pull qwen2.5-coder:7b` to enable local AI-guided setup.'));
    }

    global.suppressLogs = true;
    const notes = await promptText('Notes (auth type, docs URL, etc.):', '');
    global.suppressLogs = false;

    const brokersPath = path.join(utils.REPO_ROOT, 'config', 'brokers.yaml');
    const entry = [
      '',
      `- name: "${name}"`,
      `  endpoint: "${endpoint}"`,
      `  notes: "${notes}"`,
      `  added: "${new Date().toISOString()}"`,
      '',
    ].join('\n');
    fs.mkdirSync(path.dirname(brokersPath), { recursive: true });
    fs.appendFileSync(brokersPath, entry, 'utf8');
    printPayload({ ok: true, saved: { name, endpoint }, config: brokersPath }, args);
    return 0;
  }

  return 0;
}

/**
 * MT5 profile management: list / add / delete.
 * Stores credentials encrypted in the local vault.
 */
async function commandMt5Profile(args) {
  const {
    listMt5Profiles, upsertMt5Profile, deleteMt5Profile, getMt5ProfileChoices,
  } = require('#shared/mt5_profiles');
  const { promptPassword } = require('../../lib/auth.js');
  const subcommand = args[0] || 'list';

  if (subcommand === 'list') {
    const profiles = listMt5Profiles();
    if (hasFlag(args, '--json')) {
      printPayload({ profiles }, args);
    } else {
      pageText(renderMt5ProfileList(profiles), args);
    }
    return 0;
  }

  if (subcommand === 'add' || subcommand === 'edit') {
    global.suppressLogs = true;
    const slot = await promptSelect('Account slot:', getMt5ProfileChoices());
    const login = await promptText('MT5 Login ID:', '');
    global.suppressLogs = false;
    if (!login) { console.error('Login ID is required.'); return 1; }
    global.suppressLogs = true;
    const server = await promptText('MT5 Server (e.g. ICMarkets-Live01):', '');
    global.suppressLogs = false;
    if (!server) { console.error('Server is required.'); return 1; }
    const password = await promptPassword('MT5 Password (stored encrypted)');
    global.suppressLogs = true;
    const notes = await promptText('Notes (optional):', '');
    global.suppressLogs = false;
    const profile = upsertMt5Profile({ slot, login, server, password, notes });
    printPayload({ ok: true, saved: profile }, args);
    return 0;
  }

  if (subcommand === 'delete') {
    global.suppressLogs = true;
    const slot = args[1] || await promptSelect('Select slot to delete:', getMt5ProfileChoices());
    global.suppressLogs = false;
    const confirmed = await promptConfirm(`Delete MT5 profile for slot "${slot}"?`);
    if (!confirmed) return 0;
    const { deleteMt5Profile: del } = require('#shared/mt5_profiles');
    const removed = del(slot);
    printPayload({ ok: true, removed }, args);
    return 0;
  }

  printPayload({ commands: ['list', 'add', 'delete'] }, args);
  return 0;
}

async function commandMt5Doctor(args) {
  const {
    getMt5Profile,
    getMt5ProfileChoices,
    getDefaultMt5TerminalPath,
  } = require('#shared/mt5_profiles');

  let slot = optionValue(args, '--slot', null);
  if (!slot) {
    global.suppressLogs = true;
    slot = await promptSelect('Select MT5 account to diagnose:', getMt5ProfileChoices());
    global.suppressLogs = false;
  }

  const profile = getMt5Profile(slot, { includeSecret: false });
  const terminal = profile && profile.terminal_path ? profile.terminal_path : getDefaultMt5TerminalPath();
  const bridgeInstalled = fs.existsSync(path.join(utils.REPO_ROOT, 'backend', 'scripts', 'verification', 'mt5_bridge_install.js'));
  const report = inspectMt5Setup(slot, profile, terminal, bridgeInstalled);

  if (hasFlag(args, '--json')) {
    printPayload(report, args);
  } else {
    pageText(renderMt5Diagnostics(report), args);
  }
  return report.ok ? 0 : 1;
}

/**
 * Launches MT5 terminal using a saved vault profile.
 */
async function commandMt5Connect(args) {
  if (!(await requireAuth('MT5 connect'))) return 1;
  const os = require('node:os');
  const { spawn } = require('node:child_process');
  const {
    getMt5Profile, getMt5ProfileChoices, getDefaultMt5TerminalPath,
  } = require('#shared/mt5_profiles');

  let slot = optionValue(args, '--slot', null);
  if (!slot) {
    global.suppressLogs = true;
    slot = await promptSelect('Select MT5 account to connect:', getMt5ProfileChoices());
    global.suppressLogs = false;
  }

  const profile = getMt5Profile(slot, { includeSecret: true });
  const terminal = profile && profile.terminal_path ? profile.terminal_path : getDefaultMt5TerminalPath();
  const bridgeInstalled = fs.existsSync(path.join(utils.REPO_ROOT, 'backend', 'scripts', 'verification', 'mt5_bridge_install.js'));
  const report = inspectMt5Setup(slot, profile ? { ...profile, has_password: Boolean(profile.password) } : null, terminal, bridgeInstalled);
  if (!report.ok) {
    if (hasFlag(args, '--json')) {
      printPayload(report, args);
    } else {
      pageText(renderMt5Diagnostics(report), args);
    }
    return 1;
  }

  const configPath = path.join(os.tmpdir(), `sovereign_mt5_${Date.now()}.ini`);
  const config = [
    '[Common]',
    `Login=${profile.login}`,
    `Password=${profile.password}`,
    `Server=${profile.server}`,
    'ProxyEnable=0',
    '',
  ].join('\r\n');
  fs.writeFileSync(configPath, config, { encoding: 'utf8', mode: 0o600 });

  const child = spawn(terminal, [`/config:${configPath}`], { detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
  setTimeout(() => { try { fs.rmSync(configPath, { force: true }); } catch {} }, 5000);

  const masked = String(profile.login).replace(/^(.{2}).*(.{2})$/, '$1***$2');
  printPayload({ ok: true, slot, login: masked, server: profile.server, terminal }, args);
  return 0;
}

/**
 * Installs the SovereignExport EA bridge into the MT5 terminal data directory.
 */
function commandMt5Bridge(args) {
  const bridgePath = path.join(utils.REPO_ROOT, 'backend', 'scripts', 'verification', 'mt5_bridge_install.js');
  if (!fs.existsSync(bridgePath)) {
    console.error('MT5 bridge script not found: ' + bridgePath);
    return 1;
  }
  const result = spawnSync(process.execPath, [bridgePath], {
    cwd: utils.REPO_ROOT,
    stdio: 'inherit',
    env: { ...process.env },
  });
  return result.status ?? 0;
}

/**
 * Auto-trade execution loop. Delegates to strategy automation engine.
 * Belongs in Execution, not Strategy Management.
 */
async function commandAutoTrade(args) {
  const { runAutomatedStrategies } = require('../strategy/strategy.js');
  return runAutomatedStrategies(args);
}

async function commandAgent(args) {
  const { agentLoop, isAvailable } = require('#shared/mcp_agent');
  const available = await (async () => {
    try { const { isAvailable: check } = require('#shared/ai_client'); return check(); }
    catch { return false; }
  })();

  if (!available) {
    printPayload({ error: 'Ollama is not running. Start it from the system tray or run: ollama serve' }, args);
    return 1;
  }

  const query = args.filter(a => !a.startsWith('--')).join(' ').trim()
    || await promptText('What do you want the agent to do?', '');

  if (!query) return 0;

  process.stdout.write(`\n[AGENT] Task: ${query}\n`);
  const result = await agentLoop(query);
  printPayload(result, args);
  return result.status === 'ok' ? 0 : 1;
}

/**
 * Handles the 'bot' command — thin shell into the gateway bot commands.
 */
async function commandBot(args) {
  const sub = args[0] || 'status';
  if (hasFlag(args, '--live') && !(await requireAuth('bot live trading'))) return 1;
  const gatewayArgs = ['bot', sub, ...args.slice(1)];
  if (hasFlag(args, '--json')) gatewayArgs.push('--json');
  const launch = buildTradeGatewayLaunch(gatewayArgs);
  const result = spawnSync(launch.command, launch.args, {
    cwd: utils.REPO_ROOT,
    stdio: 'inherit',
    shell: launch.shell ?? false,
  });
  return result.status ?? 0;
}

module.exports = {
  buildTradeGatewayLaunch,
  commandAddPlatform,
  commandAgent,
  commandAutoTrade,
  commandMt5,
  commandMt5Doctor,
  commandMt5Bridge,
  commandMt5Connect,
  commandMt5Profile,
  commandBot,
  commandPolymarket,
  commandTrade,
  inspectMt5Setup,
  fetchBalance,
  fetchAggregatePortfolio,
  promptTradeDeskArgs,
  renderMt5Diagnostics,
  renderMt5ProfileList,
  tradeDeskText,
};
