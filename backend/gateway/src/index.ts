import 'dotenv/config';
import * as fs from 'node:fs/promises';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
// @ts-ignore
import Alpaca from '@alpacahq/alpaca-trade-api';
import { createClobClient, resolveOwnerAddress, polymarketGet } from './clob_factory.js';
import { runCycle, runBotLoop, runForceSell, runBotHealth } from './cycle.js';
import { loadBotState, saveBotState } from './bot_state.js';
// @ts-ignore
const { buildAggregatedPortfolioSnapshot } = require('./polymarket_portfolio.js');
// @ts-ignore
const { PersistenceBridge } = require('../../../shared/lib/persistence_bridge');

const ansi = {
  reset:       '\x1b[0m',
  bold:        '\x1b[1m',
  red:         '\x1b[31m',
  green:       '\x1b[32m',
  yellow:      '\x1b[33m',
  magenta:     '\x1b[35m',
  boldGreen:   '\x1b[1;32m',
  boldYellow:  '\x1b[1;33m',
  boldMagenta: '\x1b[1;35m',
  boldCyan:    '\x1b[1;36m',
} as const;

enum OrderSide {
  BUY = 'buy',
  SELL = 'sell'
}

enum OrderStatus {
  PROPOSED = 'proposed',
  RISK_REJECTED = 'risk_rejected',
  SUBMITTED = 'submitted',
  FILLED = 'filled',
  FAILED = 'failed'
}

interface TradeOrder {
  instrumentId: string;
  side: OrderSide;
  quantity: number;
  price?: number;
  type: 'market' | 'limit';
  status: OrderStatus;
  timestamp: Date;
}


interface Position {
  symbol: string;
  assetId?: string;
  quantity: number;
  averagePrice: number;
  marketValue: number;
  unrealizedPl: number;
}

interface PolymarketTrade {
  id?: string;
  asset_id?: string;
  market?: string;
  outcome?: string;
  outcome_index?: number;
  side?: string | number;
  size?: string | number;
  price?: string | number;
  match_time?: string;
  last_update?: string;
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizePolymarketSide(side: unknown): 'buy' | 'sell' | null {
  if (typeof side === 'string') {
    const upper = side.toUpperCase();
    if (upper === 'BUY') return 'buy';
    if (upper === 'SELL') return 'sell';
  }
  if (side === 0) return 'buy';
  if (side === 1) return 'sell';
  return null;
}

function aggregatePolymarketFilledPositions(trades: PolymarketTrade[]): Position[] {
  const buckets = new Map<string, {
    assetId: string;
    symbol: string;
    quantity: number;
    costBasis: number;
    seenAt: number;
  }>();

  const sortedTrades = [...trades].sort((a, b) => {
    const ta = Date.parse(String(a.match_time || a.last_update || ''));
    const tb = Date.parse(String(b.match_time || b.last_update || ''));
    return (Number.isFinite(ta) ? ta : 0) - (Number.isFinite(tb) ? tb : 0);
  });

  for (const trade of sortedTrades) {
    const assetId = String(trade.asset_id || '');
    if (!assetId) continue;

    const side = normalizePolymarketSide(trade.side);
    if (!side) continue;

    const size = toFiniteNumber(trade.size);
    const price = toFiniteNumber(trade.price);
    if (size <= 0 || price < 0) continue;

    const key = assetId;
    const bucket = buckets.get(key) || {
      assetId: key,
      symbol: String(trade.outcome || trade.market || assetId),
      quantity: 0,
      costBasis: 0,
      seenAt: 0,
    };

    bucket.symbol = String(trade.outcome || trade.market || assetId);
    bucket.seenAt = Math.max(bucket.seenAt, Date.parse(String(trade.match_time || trade.last_update || '')) || 0);

    if (side === 'buy') {
      bucket.quantity += size;
      bucket.costBasis += size * price;
    } else {
      if (bucket.quantity > 0) {
        const avgCost = bucket.costBasis / bucket.quantity;
        const closedSize = Math.min(bucket.quantity, size);
        bucket.quantity -= closedSize;
        bucket.costBasis = Math.max(0, bucket.costBasis - (avgCost * closedSize));
      }
    }

    buckets.set(key, bucket);
  }

  return [...buckets.values()]
    .filter((bucket) => bucket.quantity > 0)
    .map((bucket) => {
      const averagePrice = bucket.quantity > 0 ? bucket.costBasis / bucket.quantity : 0;
      return {
        assetId: bucket.assetId,
        symbol: bucket.symbol,
        quantity: bucket.quantity,
        averagePrice,
        marketValue: bucket.quantity * averagePrice,
        unrealizedPl: 0,
      };
    })
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/**
 * Hypothetical Broker Interface
 */
interface BrokerAdapter {
  placeOrder(order: TradeOrder): Promise<{ orderId: string; status: string }>;
  cancelOrder(orderId: string): Promise<boolean>;
  getPortfolioBalance(): Promise<Record<string, number>>;
  getPositions(): Promise<Position[]>;
  getQuote(symbol: string): Promise<number>;
}

interface GateIoAdapterOptions {
  baseUrl?: string;
  apiKey?: string;
  apiSecret?: string;
  simulateIfMissingCredentials?: boolean;
}

interface AlpacaAdapterOptions {
  keyId?: string;
  secretKey?: string;
  paper?: boolean;
  simulateIfMissingCredentials?: boolean;
}

function sha512Hex(value: string): string {
  return crypto.createHash('sha512').update(value, 'utf8').digest('hex');
}

function signGateIoRequest(method: string, requestPath: string, query: string, body: string, timestamp: string, secret: string): string {
  const canonical = [
    method.toUpperCase(),
    requestPath,
    query,
    sha512Hex(body),
    timestamp,
  ].join('\n');
  return crypto.createHmac('sha512', secret).update(canonical, 'utf8').digest('hex');
}

function toJsonOrText(input: string): unknown {
  if (!input.trim()) {
    return {};
  }
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

/**
 * Gate.io Implementation of the Broker Adapter
 */
class GateIoAdapter implements BrokerAdapter {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly apiSecret: string | undefined;
  private readonly simulateIfMissingCredentials: boolean;

  constructor(options: GateIoAdapterOptions = {}) {
    this.baseUrl = options.baseUrl || process.env.GATEIO_BASE_URL || 'https://api.gateio.ws/api/v4';
    this.apiKey = options.apiKey || process.env.GATEIO_API_KEY;
    this.apiSecret = options.apiSecret || process.env.GATEIO_API_SECRET;
    this.simulateIfMissingCredentials = options.simulateIfMissingCredentials ?? true;
  }

  private hasCredentials(): boolean {
    return Boolean(this.apiKey && this.apiSecret);
  }

  private async requestJson(method: string, requestPath: string, body?: Record<string, unknown>): Promise<unknown> {
    const payload = body ? JSON.stringify(body) : '';
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = signGateIoRequest(method, requestPath, '', payload, timestamp, this.apiSecret || '');

    const response = await fetch(`${this.baseUrl}${requestPath}`, {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        KEY: this.apiKey || '',
        SIGN: signature,
        Timestamp: timestamp,
      },
      body: payload || undefined,
    });

    const responseText = await response.text();
    const parsed = toJsonOrText(responseText);
    if (!response.ok) {
      const message = typeof parsed === 'string'
        ? parsed
        : JSON.stringify(parsed);
      throw new Error(`Gate.io request failed (${response.status}): ${message}`);
    }
    return parsed;
  }

  async placeOrder(order: TradeOrder): Promise<{ orderId: string; status: string }> {
    console.log(`[GATE.IO] Placing ${order.side.toUpperCase()} ${order.type} order for ${order.instrumentId}`);
    console.log(`[GATE.IO] Quantity: ${order.quantity}${order.price ? `, Price: ${order.price}` : ''}`);

    if (!this.hasCredentials()) {
      if (!this.simulateIfMissingCredentials) {
        throw new Error('Gate.io credentials are not configured');
      }
      return {
        orderId: `gate-sim-${Math.random().toString(36).substring(2, 11)}`,
        status: 'open',
      };
    }

    const payload: Record<string, unknown> = {
      currency_pair: order.instrumentId,
      side: order.side,
      type: order.type,
      amount: String(order.quantity),
    };
    if (typeof order.price === 'number' && Number.isFinite(order.price) && order.price > 0) {
      payload.price = String(order.price);
    }

    const response = await this.requestJson('POST', '/spot/orders', payload);
    const record = (response as Record<string, unknown>) || {};
    return {
      orderId: String(record.id || record.order_id || record.client_order_id || `gate-${Date.now()}`),
      status: String(record.status || 'submitted'),
    };
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    console.log(`[GATE.IO] Canceling order ${orderId}`);
    if (!this.hasCredentials()) {
      return this.simulateIfMissingCredentials;
    }
    await this.requestJson('DELETE', `/spot/orders/${encodeURIComponent(orderId)}`);
    return true;
  }

  async getPortfolioBalance(): Promise<Record<string, number>> {
    console.log(`[GATE.IO] Fetching account balances`);
    if (!this.hasCredentials()) {
      return { USDT: 10000, BTC: 0.5 };
    }

    const response = await this.requestJson('GET', '/spot/accounts');
    const balances: Record<string, number> = {};
    if (Array.isArray(response)) {
      for (const item of response) {
        if (item && typeof item === 'object') {
          const record = item as Record<string, unknown>;
          const currency = String(record.currency || record.currency_pair || record.name || '').toUpperCase();
          const balance = Number(record.available ?? record.balance ?? record.total ?? 0);
          if (currency) {
            balances[currency] = balance;
          }
        }
      }
    }
    return balances;
  }

  async getPositions(): Promise<Position[]> {
    const balances = await this.getPortfolioBalance();
    const heldCurrencies = Object.entries(balances).filter(([sym, qty]) => qty > 0 && sym !== 'USDT');

    if (heldCurrencies.length === 0) return [];

    // Fetch spot tickers to enrich balances with current market prices
    let tickerMap: Record<string, number> = {};
    try {
      const tickers = await this.requestJson('GET', '/spot/tickers') as any[];
      if (Array.isArray(tickers)) {
        for (const t of tickers) {
          if (t && t.currency_pair) {
            const lastPrice = Number(t.last ?? t.last_price ?? 0);
            if (lastPrice > 0) tickerMap[String(t.currency_pair).toUpperCase()] = lastPrice;
          }
        }
      }
    } catch {
      // Non-fatal: fall back to zero market value
    }

    return heldCurrencies.map(([symbol, qty]) => {
      const pair = `${symbol}_USDT`;
      const currentPrice = tickerMap[pair] ?? 0;
      return {
        symbol,
        quantity: qty,
        averagePrice: 0, // Requires trade history traversal; not implemented
        marketValue: Number((qty * currentPrice).toFixed(4)),
        unrealizedPl: 0, // averagePrice unknown; cannot compute PnL
      };
    });
  }

  async getQuote(symbol: string): Promise<number> {
    if (!this.hasCredentials()) {
        return 150.0; // Dummy price
    }
    const pair = symbol.includes('_') ? symbol.toUpperCase() : `${symbol.toUpperCase()}_USDT`;
    try {
        const tickers = await this.requestJson('GET', `/spot/tickers?currency_pair=${pair}`) as any[];
        if (Array.isArray(tickers) && tickers[0]) {
            return Number(tickers[0].last || tickers[0].last_price || 0);
        }
        return 0;
    } catch (err: any) {
        console.warn(`[GATE.IO] Quote fetch failed for ${pair}: ${err.message}`);
        return 0;
    }
  }
}

/**
 * Alpaca Implementation using official SDK
 */
class AlpacaAdapter implements BrokerAdapter {
  private alpaca: any;
  private readonly simulateIfMissingCredentials: boolean;

  constructor(options: AlpacaAdapterOptions = {}) {
    const keyId = options.keyId || process.env.ALPACA_API_KEY;
    const secretKey = options.secretKey || process.env.ALPACA_API_SECRET;
    const paper = options.paper ?? (process.env.ALPACA_URL?.includes('paper') || true);
    this.simulateIfMissingCredentials = options.simulateIfMissingCredentials ?? true;

    if (keyId && secretKey) {
      this.alpaca = new Alpaca({
        keyId,
        secretKey,
        paper,
      });
    }
  }

  private hasCredentials(): boolean {
    return Boolean(this.alpaca);
  }

  async placeOrder(order: TradeOrder): Promise<{ orderId: string; status: string }> {
    console.log(`[ALPACA-SDK] Placing ${order.side.toUpperCase()} ${order.type} order for ${order.instrumentId}`);
    console.log(`[ALPACA-SDK] Quantity: ${order.quantity}${order.price ? `, Price: ${order.price}` : ''}`);

    if (!this.hasCredentials()) {
      if (!this.simulateIfMissingCredentials) {
        throw new Error('Alpaca credentials are not configured');
      }
      return {
        orderId: `alpaca-sim-${Math.random().toString(36).substring(2, 11)}`,
        status: 'accepted',
      };
    }

    try {
      const payload: any = {
        symbol: order.instrumentId,
        qty: order.quantity,
        side: order.side,
        type: order.type,
        time_in_force: 'gtc',
      };
      
      if (order.type === 'limit' && order.price) {
        payload.limit_price = order.price;
      }

      const alpacaOrder = await this.alpaca.createOrder(payload);
      return {
        orderId: alpacaOrder.id,
        status: alpacaOrder.status,
      };
    } catch (err: any) {
      throw new Error(`Alpaca SDK Order Error: ${err.message}`);
    }
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    console.log(`[ALPACA-SDK] Canceling order ${orderId}`);
    if (!this.hasCredentials()) {
      return this.simulateIfMissingCredentials;
    }
    await this.alpaca.cancelOrder(orderId);
    return true;
  }

  async getPortfolioBalance(): Promise<Record<string, number>> {
    console.log(`[ALPACA-SDK] Fetching account details`);
    if (!this.hasCredentials()) {
      return { USD: 100000, BUYING_POWER: 200000, EQUITY: 100000 };
    }

    try {
      const account = await this.alpaca.getAccount();
      return {
        USD: Number(account.cash || 0),
        BUYING_POWER: Number(account.buying_power || 0),
        EQUITY: Number(account.equity || 0)
      };
    } catch (err: any) {
      throw new Error(`Alpaca SDK Account Error: ${err.message}`);
    }
  }

  async getPositions(): Promise<Position[]> {
    console.log(`[ALPACA-SDK] Fetching positions`);
    if (!this.hasCredentials()) {
      return [
        { symbol: 'AAPL', quantity: 10, averagePrice: 150, marketValue: 1750, unrealizedPl: 250 },
        { symbol: 'TSLA', quantity: 5, averagePrice: 200, marketValue: 900, unrealizedPl: -100 }
      ];
    }

    try {
      const positions = await this.alpaca.getPositions();
      return positions.map((p: any) => ({
        symbol: p.symbol,
        quantity: Number(p.qty),
        averagePrice: Number(p.avg_entry_price),
        marketValue: Number(p.market_value),
        unrealizedPl: Number(p.unrealized_pl)
      }));
    } catch (err: any) {
      throw new Error(`Alpaca SDK Positions Error: ${err.message}`);
    }
  }

  /**
   * Advanced: Submit a Bracket Order
   */
  async placeBracketOrder(symbol: string, qty: number, takeProfitPrice: number, stopLossPrice: number) {
    if (!this.hasCredentials()) return { id: 'sim-bracket' };

    return await this.alpaca.createOrder({
      symbol,
      qty,
      side: 'buy',
      type: 'market',
      time_in_force: 'gtc',
      order_class: 'bracket',
      take_profit: {
        limit_price: takeProfitPrice,
      },
      stop_loss: {
        stop_price: stopLossPrice,
      },
    });
  }

  async getQuote(symbol: string): Promise<number> {
    if (!this.hasCredentials()) {
      return 150.0; // Dummy price
    }
    try {
      const quote = await this.alpaca.getLatestQuote(symbol);
      return Number(quote.AskPrice || quote.BidPrice || 0);
    } catch (err: any) {
      console.warn(`[ALPACA-SDK] Quote fetch failed for ${symbol}: ${err.message}`);
      return 0;
    }
  }
}

/**
 * Bridge to simulate C++ Pre-Trade Risk logic
 */
class RiskEngineBridge {
  async checkRisk(order: TradeOrder): Promise<{ approved: boolean; reason?: string }> {
    console.log(`[RISK-ENGINE] Pre-trade check for ${order.instrumentId} (${order.quantity} units)`);

    // --- NEW: Global Kill Switch Check ---
    // @ts-ignore
    const { findBackendBinary } = require('../../../shared/lib/paths');
    const binary: string | null = findBackendBinary();

    if (!binary) {
      const message = 'CRITICAL: Risk Engine binary not found or non-executable (FAIL-CLOSED)';
      // ALLOW BYPASS in Dry-Run mode to prevent development deadlock
      if (process.env.LIVE_TRADING !== 'true' && !process.argv.includes('--live')) {
        console.warn(`${ansi.boldYellow}[WARNING] ${message}${ansi.reset}`);
        console.warn(`${ansi.boldYellow}[WARNING] Proceeding without C++ risk checks (DRY-RUN ONLY)${ansi.reset}`);
        return { approved: true };
      }
      return { 
        approved: false, 
        reason: message 
      };
    }

    const result = spawnSync(binary, ['kill-switch', 'status'], { encoding: 'utf8' });
    if (result.status === 0) {
      try {
        const status = JSON.parse(result.stdout);
        if (status.status === 'engaged') {
          return { approved: false, reason: 'GLOBAL KILL SWITCH ENGAGED' };
        }
      } catch (e) {
        return { 
          approved: false, 
          reason: 'CRITICAL: Risk Engine returned invalid status payload' 
        };
      }
    } else {
      return { 
        approved: false, 
        reason: 'CRITICAL: Risk Engine process failed during safety check' 
      };
    }
    
    // Preparation for C++ Risk Check
    const notional = (order.price || 0) * order.quantity;
    const volatility = Number(process.env.ESTIMATED_PORTFOLIO_VOLATILITY || 50000); // Proxy for equity/vol
    const drawdown = Number(process.env.CURRENT_PORTFOLIO_DRAWDOWN || 0.0);
    const maxDrawdown = Number(process.env.MAX_ALLOWED_DRAWDOWN || 0.20);

    const riskCheckArgs = [
      'risk', 'check',
      '--notional', notional.toString(),
      '--volatility', volatility.toString(),
      '--drawdown', drawdown.toString(),
      '--max-drawdown', maxDrawdown.toString()
    ];

    console.log(`[RISK-ENGINE-BRIDGE] Invoking: ${binary} ${riskCheckArgs.join(' ')}`);
    const riskResult = spawnSync(binary, riskCheckArgs, { encoding: 'utf8' });

    if (riskResult.status === 0 || riskResult.status === 2) {
       try {
          const decision = JSON.parse(riskResult.stdout);
          return {
             approved: decision.approved,
             reason: decision.reason
          };
       } catch (e) {
          return {
             approved: false,
             reason: `CRITICAL: Risk Engine returned malformed JSON: ${riskResult.stdout}`
          };
       }
    }

    return { 
      approved: false, 
      reason: `CRITICAL: Risk Engine execution failed (Code: ${riskResult.status})` 
    };
  }
}

class ExecutionGateway {
  private dryRun: boolean;
  private adapter: BrokerAdapter;
  private riskEngine: RiskEngineBridge;
  private persistence: any; // PersistenceBridge (CommonJS require — value, not a type)

  constructor(options: { dryRun?: boolean; adapter?: BrokerAdapter } = {}) {
    this.dryRun = options.dryRun ?? true;
    this.adapter = options.adapter || new AlpacaAdapter();
    this.riskEngine = new RiskEngineBridge();
    this.persistence = new PersistenceBridge();
  }

  async validateOrder(order: TradeOrder): Promise<boolean> {
    console.log(`[EXECUTION] Validating order for ${order.instrumentId}`);
    
    // Basic structural validation
    if (order.quantity <= 0) {
      console.error('[RISK] Rejection: Quantity must be positive');
      return false;
    }
    if (order.type === 'limit' && (!Number.isFinite(order.price || NaN) || (order.price || 0) <= 0)) {
      console.error('[RISK] Rejection: Limit orders require a positive price');
      return false;
    }

    // Advanced risk engine validation (C++ Bridge)
    const riskResult = await this.riskEngine.checkRisk(order);
    if (!riskResult.approved) {
      console.error(`[RISK] Rejection: ${riskResult.reason}`);
      return false;
    }

    return true;
  }

  async execute(order: TradeOrder): Promise<void> {
    const isValid = await this.validateOrder(order);
    if (!isValid) {
      order.status = OrderStatus.RISK_REJECTED;
      await this.persistence.logOrder(order, 'internal', { reason: 'risk_rejected' });
      return;
    }

    if (this.dryRun) {
      console.log(`[DRY-RUN] Would execute ${order.side} ${order.quantity} of ${order.instrumentId}`);
      order.status = OrderStatus.SUBMITTED;
      await this.persistence.logOrder(order, 'simulated');
    } else {
      try {
        const result = await this.adapter.placeOrder(order);
        console.log(`[LIVE] Order placed successfully: ${result.orderId} (Status: ${result.status})`);
        order.status = result.status === 'filled' ? OrderStatus.FILLED : OrderStatus.SUBMITTED;
        
        await this.persistence.logOrder(order, 'alpaca', { order_id: result.orderId }, result);
        
      } catch (error: any) {
        console.error(`[LIVE] Execution failed: ${error}`);
        order.status = OrderStatus.FAILED;
        await this.persistence.logOrder(order, 'alpaca', { error: error.message });
      }
    }
  }

  async processProposedOrders(filePath: string): Promise<void> {
    console.log(`[GATEWAY] Looking for proposed orders in ${filePath}...`);
    try {
      const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
      const data = await fs.readFile(absolutePath, 'utf-8');
      const parsed = JSON.parse(data);
      const orders: any[] = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.orders) ? parsed.orders : [];
      
      console.log(`[GATEWAY] Found ${orders.length} orders in file`);

      for (const orderData of orders) {
        const order: TradeOrder = {
          instrumentId: orderData.instrumentId || orderData.symbol,
          side: (orderData.side || 'buy').toLowerCase() as OrderSide,
          quantity: Number(orderData.quantity || orderData.qty || 0),
          price: orderData.price ? Number(orderData.price) : undefined,
          type: (orderData.type || 'market').toLowerCase() as 'market' | 'limit',
          status: OrderStatus.PROPOSED,
          timestamp: new Date()
        };
        
        await this.execute(order);
      }
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        console.log(`[GATEWAY] No proposed orders file found at ${filePath}. Skipping.`);
      } else {
        console.error(`[GATEWAY] Error reading proposed orders: ${error.message}`);
      }
    }
  }
}

function printUsage() {
  console.log(`
Sovereign Alpaca Execution Gateway

Usage:
  npx ts-node execution_gateway/src/index.ts [command] [options]

Commands:
  buy <symbol> <qty> [type] [price]    Place a buy order
  sell <symbol> <qty> [type] [price]   Place a sell order
  balance                              Show account balance
  aggregate_portfolio                  Aggregate balances across all brokers
  polymarket portfolio                 Show pUSD, open orders, and filled positions
  polymarket markets [limit]           List active prediction markets (public, no auth)
  polymarket derive-creds              Derive L2 API credentials from POLYMARKET_PRIVATE_KEY
  process [file]                       Process proposed orders from a JSON file

Options:
  --live                               Run in LIVE mode (default is dry-run)
  --json                               Output as JSON
  --demo                               Run the demo sequence

Examples:
  npx ts-node execution_gateway/src/index.ts buy AAPL 10
  npx ts-node execution_gateway/src/index.ts sell TSLA 5 limit 180 --live
  npx ts-node execution_gateway/src/index.ts balance
  npx ts-node execution_gateway/src/index.ts polymarket portfolio
  `);
}

interface PolymarketAdapterOptions {
  host?: string;
  privateKey?: string;
  apiKey?: string;
  apiSecret?: string;
  apiPassphrase?: string;
}

/**
 * Polymarket CLOB Adapter
 * Uses @polymarket/clob-client against https://clob.polymarket.com (Polygon mainnet).
 * Requires POLYMARKET_PRIVATE_KEY + L2 credentials in env; falls back to no-credential
 * mode (public endpoints only — no balances or positions) if missing.
 */
class PolymarketAdapter implements BrokerAdapter {
  private readonly host: string;
  private readonly privateKey: string | undefined;
  private readonly creds: { key: string; secret: string; passphrase: string } | null;
  private readonly funderAddress: string | undefined;

  constructor(options: PolymarketAdapterOptions = {}) {
    this.host        = options.host        || process.env.POLYMARKET_CLOB_HOST || 'https://clob.polymarket.com';
    this.privateKey  = options.privateKey  || process.env.POLYMARKET_PRIVATE_KEY;
    const key        = options.apiKey       || process.env.POLYMARKET_API_KEY;
    const secret     = options.apiSecret    || process.env.POLYMARKET_API_SECRET;
    const passphrase = options.apiPassphrase|| process.env.POLYMARKET_API_PASSPHRASE;
    this.creds = (key && secret && passphrase) ? { key, secret, passphrase } : null;
    // Deposit/proxy wallet that actually owns collateral and orders (falls back to signer EOA).
    this.funderAddress = process.env.POLYMARKET_FUNDER_ADDRESS || process.env.POLYMARKET_WALLET_ADDRESS || undefined;
  }

  private hasCredentials(): boolean {
    return Boolean(this.privateKey && this.creds);
  }

  async placeOrder(order: TradeOrder): Promise<{ orderId: string; status: string }> {
    if (!this.hasCredentials()) throw new Error('Polymarket credentials not configured');
    const client = await createClobClient({ withCreds: true, host: this.host, privateKey: this.privateKey, creds: this.creds, funderAddress: this.funderAddress });
    const signedOrder = await client.createOrder({
      tokenID:    order.instrumentId,
      price:      order.price ?? 0.5,
      size:       order.quantity,
      side:       order.side.toUpperCase(),
    });
    const resp = await client.postOrder(signedOrder);
    return { orderId: resp.orderID ?? `poly-${Date.now()}`, status: resp.status ?? 'submitted' };
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    if (!this.hasCredentials()) throw new Error('Polymarket credentials not configured');
    const client = await createClobClient({ withCreds: true, host: this.host, privateKey: this.privateKey, creds: this.creds, funderAddress: this.funderAddress });
    await client.cancelOrder({ orderID: orderId });
    return true;
  }

  async getPortfolioBalance(): Promise<Record<string, number>> {
    if (!this.hasCredentials()) throw new Error('Polymarket credentials not configured');
    // Sync the cached balance first. Polymarket requires the update endpoint after funding
    // or allowance changes, then the balance read can reflect the live wallet state.
    await polymarketGet('/balance-allowance/update', { asset_type: 'COLLATERAL' }, {
      privateKey: this.privateKey,
      creds: this.creds ?? undefined,
      funderAddress: this.funderAddress,
      host: this.host,
    });
    const data = await polymarketGet('/balance-allowance', { asset_type: 'COLLATERAL' }, {
      privateKey: this.privateKey,
      creds: this.creds ?? undefined,
      funderAddress: this.funderAddress,
      host: this.host,
    });
    return { pUSD: Number(data?.balance ?? 0) };
  }

  async getOpenOrders(): Promise<Position[]> {
    if (!this.hasCredentials()) throw new Error('Polymarket credentials not configured');
    const owner = await resolveOwnerAddress(this.privateKey as string, this.funderAddress);
    const raw = await polymarketGet('/data/orders', { owner }, {
      privateKey: this.privateKey,
      creds: this.creds ?? undefined,
      funderAddress: this.funderAddress,
      host: this.host,
    }) ?? [];
    const orders: any[] = Array.isArray(raw) ? raw : raw?.data ?? [];
    return orders
      .map((o: any) => {
        const original = toFiniteNumber(o.original_size);
        const matched = toFiniteNumber(o.size_matched);
        const remaining = Math.max(0, original - matched);
        return {
          symbol: String(o.outcome ?? o.market ?? o.asset_id ?? ''),
          quantity: remaining,
          averagePrice: toFiniteNumber(o.price),
          marketValue: remaining * toFiniteNumber(o.price),
          unrealizedPl: 0,
        };
      })
      .filter((o) => o.quantity > 0)
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
  }

  async getPositions(): Promise<Position[]> {
    if (!this.hasCredentials()) throw new Error('Polymarket credentials not configured');
    const owner = await resolveOwnerAddress(this.privateKey as string, this.funderAddress);
    const raw = await polymarketGet('/trades', { owner, limit: '1000' }, {
      privateKey: this.privateKey,
      creds: this.creds ?? undefined,
      funderAddress: this.funderAddress,
      host: this.host,
    }) ?? [];
    const trades: PolymarketTrade[] = Array.isArray(raw) ? raw : raw?.data ?? [];
    const positions = aggregatePolymarketFilledPositions(trades);

    if (positions.length === 0) return [];

    const clientForQuote = await createClobClient({ host: this.host });
    const priced = await Promise.all(positions.map(async (position) => {
      const tokenId = position.assetId || position.symbol;
      let currentPrice = 0;
      try {
        const resp = await clientForQuote.getPrice(tokenId, 'BUY');
        currentPrice = Number(resp?.price ?? resp ?? 0);
      } catch {
        currentPrice = 0;
      }
      const marketValue = currentPrice > 0 ? currentPrice * position.quantity : position.marketValue;
      const unrealizedPl = currentPrice > 0 ? (currentPrice - position.averagePrice) * position.quantity : 0;
      return {
        ...position,
        marketValue,
        unrealizedPl,
      };
    }));

    return priced.sort((a, b) => a.symbol.localeCompare(b.symbol));
  }

  async getQuote(symbol: string): Promise<number> {
    const client = await createClobClient({ host: this.host }); // public endpoint, no creds
    try {
      const resp = await client.getPrice(symbol, 'BUY');
      return Number(resp?.price ?? resp ?? 0);
    } catch {
      return 0;
    }
  }
}

interface PolymarketSection {
  ok: boolean;
  configured: boolean;
  lastUpdated?: string;
  balance?: Record<string, number>;
  openOrders?: Position[];
  positions?: Position[];
  error?: string;
}

function renderPolymarketSection(pm: PolymarketSection) {
  console.log(`\n${ansi.boldMagenta}--- PREDICTION MARKETS (Polymarket CLOB) ---${ansi.reset}`);
  if (!pm.configured) {
    console.log(`  ${ansi.yellow}Not configured — set POLYMARKET_PRIVATE_KEY + POLYMARKET_API_KEY/SECRET/PASSPHRASE${ansi.reset}`);
    return;
  }
  if (!pm.ok) {
    console.log(`  ${ansi.red}Error: ${pm.error}${ansi.reset}`);
    return;
  }
  if (pm.lastUpdated) {
    console.log(`  Last updated: ${pm.lastUpdated} (live fetch)`);
  }
  const pusdBalance = pm.balance?.pUSD ?? 0;
  console.log(`  Balance: pUSD ${ansi.green}${pusdBalance.toLocaleString()}${ansi.reset}`);
  if (pm.openOrders && pm.openOrders.length > 0) {
    console.log(`${ansi.bold}  Open Orders (${pm.openOrders.length}):${ansi.reset}`);
    pm.openOrders.forEach((p) => {
      console.log(`  ${p.symbol.padEnd(20)} | Remaining: ${p.quantity.toString().padEnd(6)} | Value: $${p.marketValue.toLocaleString().padEnd(10)}`);
    });
  } else {
    console.log('  No open orders.');
  }
  if (pm.positions && pm.positions.length > 0) {
    console.log(`${ansi.bold}  Filled Positions (${pm.positions.length}):${ansi.reset}`);
    pm.positions.forEach((p) => {
      const plColor = p.unrealizedPl >= 0 ? ansi.green : ansi.red;
      console.log(`  ${p.symbol.padEnd(20)} | Qty: ${p.quantity.toString().padEnd(6)} | Value: $${p.marketValue.toLocaleString().padEnd(10)} | PnL: ${plColor}$${p.unrealizedPl.toLocaleString()}${ansi.reset}`);
    });
  } else {
    console.log('  No filled positions.');
  }
}

async function fetchPolymarketPortfolio(): Promise<PolymarketSection> {
  const adapter = new PolymarketAdapter();
  const configured = adapter['hasCredentials']();
  if (!configured) {
    return { ok: false, configured: false, error: 'Polymarket credentials not set (POLYMARKET_API_KEY / _SECRET / _PASSPHRASE / _PRIVATE_KEY)' };
  }
  try {
    const [balance, openOrders, filledPositions] = await Promise.all([
      adapter.getPortfolioBalance(),
      adapter.getOpenOrders(),
      adapter.getPositions(),
    ]);
    return { ok: true, configured: true, lastUpdated: new Date().toISOString(), balance, openOrders, positions: filledPositions };
  } catch (e: any) {
    return { ok: false, configured: true, error: e.message };
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }

  const isLive = process.env.LIVE_TRADING === 'true' || args.includes('--live');
  const useJson = args.includes('--json');
  const adapter = new AlpacaAdapter({ simulateIfMissingCredentials: !isLive });
  const gateway = new ExecutionGateway({ dryRun: !isLive, adapter });
  
  const command = args[0].toLowerCase();

  if (command === 'buy' || command === 'sell') {
    // SANITIZATION
    const rawSymbol = String(args[1] || '').toUpperCase();
    const symbol = rawSymbol.replace(/[^A-Z0-9.\-_]/g, '');
    
    let qty: number;
    const rawQty = String(args[2] || '');
    if (rawQty.startsWith('amount:')) {
      const usdAmount = Number(rawQty.split(':')[1]);
      if (!Number.isFinite(usdAmount) || usdAmount <= 0) {
        if (useJson) {
          console.log(JSON.stringify({ ok: false, error: 'Valid positive USD amount is required for amount: sizing' }));
        } else {
          console.error('Error: Valid positive USD amount is required for amount: sizing');
        }
        process.exit(1);
      }
      const price = await adapter.getQuote(symbol);
      if (price <= 0) {
        if (useJson) {
          console.log(JSON.stringify({ ok: false, error: `Unable to fetch current price for ${symbol} to calculate dollar-based sizing` }));
        } else {
          console.error(`Error: Unable to fetch current price for ${symbol} to calculate dollar-based sizing`);
        }
        process.exit(1);
      }
      qty = Math.floor(usdAmount / price);
      if (!useJson) {
        console.log(`[GATEWAY] Dollar-based sizing: $${usdAmount} / $${price} = ${qty} units`);
      }
    } else {
      qty = Number(rawQty);
    }
    
    // Filter out flags from potential type/price positions
    const nonFlagArgs = args.slice(3).filter(a => !a.startsWith('--'));
    const type = (nonFlagArgs[0] || 'market').toLowerCase() as 'market' | 'limit';
    const price = nonFlagArgs[1] ? Number(nonFlagArgs[1]) : undefined;

    if (!symbol || !Number.isFinite(qty) || qty <= 0) {
      if (useJson) {
          console.log(JSON.stringify({ ok: false, error: 'Symbol and valid positive quantity are required' }));
      } else {
          console.error('Error: Symbol and valid positive quantity are required (Check if amount: calculation resulted in 0)');
          printUsage();
      }
      process.exit(1);
    }
    
    if (type === 'limit' && (!price || !Number.isFinite(price) || price <= 0)) {
        if (useJson) {
            console.log(JSON.stringify({ ok: false, error: 'Limit orders require a valid positive price' }));
        } else {
            console.error('Error: Limit orders require a valid positive price');
        }
        process.exit(1);
    }

    const order: TradeOrder = {
      instrumentId: symbol,
      side: command as OrderSide,
      quantity: qty,
      type,
      price,
      status: OrderStatus.PROPOSED,
      timestamp: new Date()
    };

    await gateway.execute(order);
    if (useJson) {
        console.log(JSON.stringify({ ok: true, order }));
    }
  } else if (command === 'balance') {
    const balances = await adapter.getPortfolioBalance();
    if (useJson) {
        console.log(JSON.stringify(balances));
    } else {
        console.log(`[GATEWAY] Current Portfolio Balances:`, balances);
    }
  } else if (command === 'aggregate_portfolio') {
    const isVerbose = !useJson;
    if (isVerbose) console.log('[GATEWAY] Aggregating multi-broker portfolios...');
    
    try {
      const adapters = [
        { name: 'Alpaca (Live)', adapter: new AlpacaAdapter({ paper: false, simulateIfMissingCredentials: false }) },
        { name: 'Alpaca (Paper)', adapter: new AlpacaAdapter({ paper: true, simulateIfMissingCredentials: false }) },
        { name: 'Gate.io', adapter: new GateIoAdapter({ simulateIfMissingCredentials: false }) },
      ];

      const results = await Promise.all(adapters.map(async (entry) => {
        try {
          const [balance, positions] = await Promise.all([
            entry.adapter.getPortfolioBalance(),
            entry.adapter.getPositions()
          ]);
          return { name: entry.name, ok: true, balance, positions };
        } catch (e: any) {
          return { name: entry.name, ok: false, error: e.message };
        }
      }));

      const [polymarket] = await Promise.all([fetchPolymarketPortfolio()]);
      const aggregated: any = buildAggregatedPortfolioSnapshot(results, polymarket);

      // Deduplicate positions by symbol (simple sum)
      const mergedPositions = new Map<string, Position>();
      for (const p of aggregated.positions) {
        if (mergedPositions.has(p.symbol)) {
          const existing = mergedPositions.get(p.symbol)!;
          const totalQty = existing.quantity + p.quantity;
          const avgPrice = ((existing.quantity * existing.averagePrice) + (p.quantity * p.averagePrice)) / totalQty;
          mergedPositions.set(p.symbol, {
            symbol: p.symbol,
            quantity: totalQty,
            averagePrice: Number(avgPrice.toFixed(4)),
            marketValue: existing.marketValue + p.marketValue,
            unrealizedPl: existing.unrealizedPl + p.unrealizedPl
          });
        } else {
          mergedPositions.set(p.symbol, { ...p });
        }
      }
      aggregated.positions = Array.from(mergedPositions.values());

      if (useJson) {
        console.log(JSON.stringify(aggregated));
      } else {
        console.log(`${ansi.boldCyan}--- MULTI-BROKER PORTFOLIO ---${ansi.reset}`);
        console.log(`Total Equity (Aggregated): $${ansi.boldGreen}${aggregated.total_equity.toLocaleString()}${ansi.reset}`);
        console.log(`Total Cash: $${ansi.green}${aggregated.total_usd.toLocaleString()}${ansi.reset}`);
        console.log(`${ansi.bold}Brokers:${ansi.reset}`);
        aggregated.brokers.forEach((b: any) => {
          const statusColor = b.status === 'connected' ? ansi.green : ansi.red;
          console.log(`  - ${b.name}: ${statusColor}${b.status}${ansi.reset} ${b.error ? `(${b.error})` : ''}`);
        });
        console.log(`${ansi.bold}Active Positions (${aggregated.positions.length}):${ansi.reset}`);
        aggregated.positions.forEach((p: Position) => {
          const plColor = p.unrealizedPl >= 0 ? ansi.green : ansi.red;
          console.log(`  ${p.symbol.padEnd(6)} | Qty: ${p.quantity.toString().padEnd(6)} | Value: $${p.marketValue.toLocaleString().padEnd(10)} | PnL: ${plColor}$${p.unrealizedPl.toLocaleString()}${ansi.reset}`);
        });

        renderPolymarketSection(aggregated.prediction_markets.polymarket);
      }
    } catch (e: any) {
      if (useJson) {
        console.log(JSON.stringify({ ok: false, error: e.message }));
      } else {
        console.error(`[GATEWAY] Aggregation failed: ${e.message}`);
      }
    }
  } else if (command === 'polymarket') {
    const sub = (args[1] || 'portfolio').toLowerCase();
    if (sub === 'portfolio' || sub === 'balance') {
      const pm = await fetchPolymarketPortfolio();
      if (useJson) {
        console.log(JSON.stringify(pm));
      } else {
        renderPolymarketSection(pm);
      }
    } else if (sub === 'derive-creds') {
      const pk = process.env.POLYMARKET_PRIVATE_KEY;
      if (!pk) {
        console.error(`${ansi.red}POLYMARKET_PRIVATE_KEY not set in .env${ansi.reset}`);
        process.exit(1);
      }
      try {
        const { Wallet } = await import('ethers');
        const signer = new Wallet(pk);
        const client = await createClobClient({ privateKey: pk });
        console.log(`${ansi.boldYellow}Deriving L2 API credentials from wallet ${signer.address}...${ansi.reset}`);
        const creds = await (client as any).createOrDeriveApiKey();
        if (!creds || typeof creds !== 'object') {
          throw new Error('Polymarket auth returned an empty response');
        }
        const credsObj = creds as Record<string, any>;
        if (typeof credsObj.error === 'string' && credsObj.error) {
          throw new Error(`Polymarket auth failed: ${credsObj.error}`);
        }
        const fieldSummary = {
          key: typeof credsObj.key,
          secret: typeof credsObj.secret,
          passphrase: typeof credsObj.passphrase,
          apiKey: typeof credsObj.apiKey,
          apiKeys: Array.isArray(credsObj.apiKeys) ? `array(${credsObj.apiKeys.length})` : typeof credsObj.apiKeys,
        };
        const normalizedCreds =
          credsObj.key ? credsObj :
          Array.isArray(credsObj.apiKeys) && credsObj.apiKeys[0] ? credsObj.apiKeys[0] :
          credsObj.apiKey ? { key: credsObj.apiKey, secret: credsObj.secret, passphrase: credsObj.passphrase } :
          null;
        if (!normalizedCreds?.key || !normalizedCreds?.secret || !normalizedCreds?.passphrase) {
          throw new Error(`Polymarket auth returned incomplete fields: ${JSON.stringify(fieldSummary)}`);
        }
        if (useJson) {
          console.log(JSON.stringify(normalizedCreds));
        } else {
          console.log(`\n${ansi.boldCyan}Paste these into your .env:${ansi.reset}`);
          console.log(`POLYMARKET_API_KEY=${normalizedCreds.key}`);
          console.log(`POLYMARKET_API_SECRET=${normalizedCreds.secret}`);
          console.log(`POLYMARKET_API_PASSPHRASE=${normalizedCreds.passphrase}`);
        }
      } catch (e: any) {
        console.error(`${ansi.red}derive-creds failed: ${e.message}${ansi.reset}`);
        process.exit(1);
      }
    } else if (sub === 'markets') {
      try {
        const client = await createClobClient(); // public endpoint, no pk needed for market list
        // getMarkets() returns { data: [...], next_cursor } — not a bare array
        const resp = await (client as any).getMarkets();
        const list: any[] = Array.isArray(resp) ? resp : (resp?.data ?? []);
        const limit = Number(args[2]) || 10;
        const page  = list.slice(0, limit);
        if (useJson) {
          console.log(JSON.stringify({ ok: true, count: list.length, data: page }));
        } else {
          console.log(`${ansi.boldCyan}Active Markets (${page.length} of ${list.length}):${ansi.reset}`);
          page.forEach((m: any) => {
            console.log(`  ${String(m.question ?? m.condition_id ?? '').slice(0, 72)}`);
            (m.tokens ?? []).forEach((t: any) =>
              console.log(`    ${ansi.yellow}${String(t.outcome ?? '').padEnd(6)}${ansi.reset}  token: ${t.token_id}`)
            );
          });
        }
      } catch (e: any) {
        console.error(`${ansi.red}markets fetch failed: ${e.message}${ansi.reset}`);
        process.exit(1);
      }
    } else {
      console.error(`Unknown polymarket subcommand: ${sub}. Available: portfolio, balance, derive-creds, markets`);
      process.exit(1);
    }
  } else if (command === 'bot') {
    const sub = (args[1] || 'status').toLowerCase();

    if (sub === 'cycle') {
      const result = await runCycle(args.slice(1));
      if (useJson) {
        console.log(JSON.stringify(result));
      } else {
        const ok = result.errors.length === 0;
        const icon = ok ? `${ansi.green}✔${ansi.reset}` : `${ansi.yellow}⚠${ansi.reset}`;
        console.log(`\n${ansi.boldCyan}--- BOT CYCLE COMPLETE ---${ansi.reset}`);
        console.log(`  ${icon} Sold: ${result.sellsExecuted}  Bought: ${result.buysFilled}  Errors: ${result.errors.length}  DryRun: ${result.dryRun}`);
        if (result.errors.length) result.errors.forEach((e: string) => console.warn(`  ${ansi.yellow}⚠ ${e}${ansi.reset}`));
        const skipped = (result as any).skipped as string[];
        const wouldBuy = (result as any).wouldBuy as any[];
        if (skipped?.length) {
          console.log(`\n  ${ansi.yellow}Skipped:${ansi.reset}`);
          skipped.forEach((s: string) => console.log(`    · ${s}`));
        }
        if (wouldBuy?.length) {
          console.log(`\n  ${ansi.boldCyan}${result.dryRun ? 'Would buy' : 'Bought'} (${wouldBuy.length}):${ansi.reset}`);
          wouldBuy.forEach((b: any) => console.log(`    ${ansi.green}${b.side.padEnd(4)}${ansi.reset} ${b.slug}  price: ${b.price}  edge: ${b.edge}%  ai: ${b.aiProb}%  target: ${b.target}`));
        } else if (!result.errors.length && !skipped?.length) {
          console.log(`  ${ansi.yellow}No candidates met the edge threshold (${ansi.reset}run bot health to diagnose${ansi.yellow})${ansi.reset}`);
        }
      }

    } else if (sub === 'status') {
      const state = loadBotState();
      if (useJson) {
        console.log(JSON.stringify({ ok: true, ...state }));
      } else {
        console.log(`\n${ansi.boldCyan}--- BOT STATUS ---${ansi.reset}`);
        console.log(`  Enabled:   ${state.config.enabled ? ansi.green + 'yes' : ansi.red + 'no'}${ansi.reset}   Live: ${state.config.liveTrading ? ansi.yellow + 'YES' : 'no'}${ansi.reset}`);
        console.log(`  Positions: ${state.positions.length}/${state.config.maxPositions}   Last cycle: ${state.lastCycleAt ?? 'never'}`);
        console.log(`  Min edge:  ${(state.config.minEdgeThreshold * 100).toFixed(0)}%   Bet size: $${state.config.positionSizeUsdc}   Stop-loss: ${(state.config.stopLossPct * 100).toFixed(0)}%`);
      }

    } else if (sub === 'health') {
      const health = await runBotHealth();
      if (useJson) {
        console.log(JSON.stringify(health));
      } else {
        console.log(`\n${ansi.boldCyan}--- BOT HEALTH ---${ansi.reset}`);
        for (const c of health.checks) {
          const icon = c.ok ? `${ansi.green}✔${ansi.reset}` : `${ansi.red}✖${ansi.reset}`;
          console.log(`  ${icon}  ${c.label.padEnd(42)} ${c.ok ? ansi.green : ansi.yellow}${c.detail}${ansi.reset}`);
        }
        console.log();
        if (health.ok) {
          console.log(`  ${ansi.boldGreen}All checks passed — ready to trade.${ansi.reset}`);
        } else {
          console.log(`  ${ansi.yellow}Some checks failed. Fix the issues above, then run again.${ansi.reset}`);
        }
      }

    } else if (sub === 'run') {
      await runBotLoop(args.slice(1));

    } else if (sub === 'sell') {
      const idx = args.indexOf('--position-id');
      const posId = idx !== -1 ? args[idx + 1] : '';
      if (!posId) {
        console.error(`${ansi.red}--position-id required${ansi.reset}`);
        process.exit(1);
      }
      const result = await runForceSell(posId, args.slice(1));
      if (useJson) {
        console.log(JSON.stringify(result));
      } else {
        if (result.ok) console.log(`${ansi.green}Force-sold position ${posId}. PnL: ${result.pnl?.toFixed(4) ?? 'n/a'}${ansi.reset}`);
        else console.error(`${ansi.red}Force-sell failed: ${result.error}${ansi.reset}`);
      }

    } else if (sub === 'config') {
      const kIdx = args.indexOf('--key');
      const vIdx = args.indexOf('--value');
      const key   = kIdx !== -1 ? args[kIdx + 1] : '';
      const value = vIdx !== -1 ? args[vIdx + 1] : '';
      const state = loadBotState();
      if (key && value !== '') {
        try {
          (state.config as any)[key] = JSON.parse(value);
          saveBotState(state);
          console.log(useJson ? JSON.stringify({ ok: true, config: state.config }) : `${ansi.green}Config updated: ${key} = ${value}${ansi.reset}`);
        } catch {
          console.error(`${ansi.red}Invalid value for ${key}${ansi.reset}`);
        }
      } else {
        console.log(useJson ? JSON.stringify({ ok: true, config: state.config }) : JSON.stringify(state.config, null, 2));
      }

    } else {
      console.error(`Unknown bot subcommand: ${sub}. Available: cycle, status, run, sell, config`);
      process.exit(1);
    }

  } else if (command === 'process') {
    const proposedOrdersPath = args[1] || process.env.ORDERS_FILE || 'proposed_orders.json';
    await gateway.processProposedOrders(proposedOrdersPath);
  } else if (args.includes('--demo')) {
    console.log(`[GATEWAY] Initialized (DryRun: ${!isLive})`);
    const balances = await adapter.getPortfolioBalance();
    console.log(`[GATEWAY] Current Portfolio Balances:`, balances);
    
    const sampleOrder: TradeOrder = {
      instrumentId: 'AAPL',
      side: OrderSide.BUY,
      quantity: 1,
      type: 'market',
      status: OrderStatus.PROPOSED,
      timestamp: new Date()
    };
    await gateway.execute(sampleOrder);
  } else {
    console.error(`Unknown command: ${command}`);
    printUsage();
  }

  try {
    // No-op cleanup
  } catch (e) {}
}

if (require.main === module) {
  main().catch(console.error);
}
