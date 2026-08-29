import * as crypto from 'node:crypto';

export interface ClobClientOptions {
  withCreds?:      boolean;
  host?:           string;
  privateKey?:     string;
  creds?:          { key: string; secret: string; passphrase: string } | null;
  /** 0 = EOA, 1 = POLY_PROXY, 2 = POLY_GNOSIS_SAFE, 3 = POLY_1271. */
  signatureType?:  number;
  /** Deposit/proxy wallet that actually holds collateral and owns orders. */
  funderAddress?:  string;
}

function resolveAccountIdentity(opts: ClobClientOptions): { signatureType?: number; funderAddress?: string } {
  const funderAddress = opts.funderAddress
    ?? process.env.POLYMARKET_FUNDER_ADDRESS
    ?? process.env.POLYMARKET_WALLET_ADDRESS
    ?? undefined;

  let signatureType = opts.signatureType;
  if (signatureType === undefined && process.env.POLYMARKET_SIGNATURE_TYPE !== undefined) {
    const parsed = Number(process.env.POLYMARKET_SIGNATURE_TYPE);
    if (Number.isInteger(parsed)) signatureType = parsed;
  }
  if (signatureType === undefined && funderAddress) signatureType = 3; // POLY_1271 deposit-wallet flow
  return { signatureType, funderAddress };
}

export async function createClobClient(opts: ClobClientOptions = {}): Promise<any> {
  const { ClobClient } = await import('@polymarket/clob-client');
  const host = opts.host ?? process.env.POLYMARKET_CLOB_HOST ?? 'https://clob.polymarket.com';
  const pk   = opts.privateKey ?? process.env.POLYMARKET_PRIVATE_KEY;

  if (!pk) return new ClobClient(host, 137);

  const { Wallet } = await import('ethers');
  const signer = new Wallet(pk);
  const creds  = opts.withCreds
    ? (opts.creds ?? {
        key:        process.env.POLYMARKET_API_KEY,
        secret:     process.env.POLYMARKET_API_SECRET,
        passphrase: process.env.POLYMARKET_API_PASSPHRASE,
      })
    : undefined;

  const { signatureType, funderAddress } = resolveAccountIdentity(opts);
  return new ClobClient(host, 137, signer, creds as any, signatureType as any, funderAddress as any);
}

/**
 * The address that owns orders/trades/collateral for the active account:
 * funder/deposit wallet if configured, otherwise the signing EOA.
 */
export async function resolveOwnerAddress(privateKey: string, funderAddress?: string): Promise<string> {
  const funder = funderAddress
    ?? process.env.POLYMARKET_FUNDER_ADDRESS
    ?? process.env.POLYMARKET_WALLET_ADDRESS;
  if (funder) return funder;
  const { Wallet } = await import('ethers');
  return new Wallet(privateKey).address;
}

// ─── Authenticated GET for Polymarket account-data requests ───────────────────
//
// The SDK hardcodes POLY_ADDRESS = signer.getAddress() (the EOA) in every L2
// request. For deposit-wallet / POLY_1271 users the funded account is the
// funderAddress, so the request needs the funderAddress in query params, but
// the L2 auth header still must be signed by the signer EOA.
//
// Fix: build L2 headers manually with POLY_ADDRESS = signer EOA, then use
// axios (already installed by the SDK) so the transport matches the SDK exactly.

interface L2Creds { key: string; secret: string; passphrase: string }

function buildHmacSignature(secret: string, ts: number, method: string, path: string): string {
  const message = `${ts}GET${path}`;
  const key = Buffer.from(secret, 'base64');
  const sig = crypto.createHmac('sha256', key).update(message).digest('base64');
  return sig.replace(/\+/g, '-').replace(/\//g, '_');
}

function buildL2Headers(address: string, creds: L2Creds, requestPath: string): Record<string, string> {
  const ts  = Math.floor(Date.now() / 1000);
  const sig = buildHmacSignature(creds.secret, ts, 'GET', requestPath);
  return {
    'POLY_ADDRESS':    address,
    'POLY_SIGNATURE':  sig,
    'POLY_TIMESTAMP':  `${ts}`,
    'POLY_API_KEY':    creds.key,
    'POLY_PASSPHRASE': creds.passphrase,
    'User-Agent':      '@polymarket/clob-client',
    'Accept':          '*/*',
  };
}

/**
 * Authenticated GET via axios (same transport as the SDK),
 * but with POLY_ADDRESS = funderAddress (deposit wallet) instead of the signer EOA.
 */
export async function polymarketGet(path: string, queryParams: Record<string, string> = {}, opts: {
  privateKey?: string;
  creds?: L2Creds;
  funderAddress?: string;
  signatureType?: number;
  host?: string;
} = {}): Promise<any> {
  const host  = opts.host ?? process.env.POLYMARKET_CLOB_HOST ?? 'https://clob.polymarket.com';
  const creds = opts.creds ?? {
    key:        process.env.POLYMARKET_API_KEY ?? '',
    secret:     process.env.POLYMARKET_API_SECRET ?? '',
    passphrase: process.env.POLYMARKET_API_PASSPHRASE ?? '',
  };

  const { signatureType, funderAddress } = resolveAccountIdentity(opts);

  const pk = opts.privateKey ?? process.env.POLYMARKET_PRIVATE_KEY ?? '';
  const { Wallet } = await import('ethers');
  const signerAddress = new Wallet(pk).address;

  // Use the same axios the SDK installs — identical transport/SSL behaviour.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const axios = require('axios') as any;
  const url   = `${host}${path}`;
  const headers = buildL2Headers(signerAddress, creds as L2Creds, path);
  const params = signatureType === undefined
    ? queryParams
    : { ...queryParams, signature_type: String(signatureType) };

  const resp = await axios.get(url, { headers, params });
  return resp.data;
}
