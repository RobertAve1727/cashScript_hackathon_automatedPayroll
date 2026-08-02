import { useSyncExternalStore } from 'react';

import { bytesToHex } from '../lib/format';
import { cashAddressToPkh } from './cashaddr';

/**
 * Paytaca over WalletConnect v2 — the employee-onboarding beat.
 *
 * An employee connects their own wallet, the dApp asks it for an address, and
 * `cashaddr.ts` turns that address into the 20-byte `payeePkh` that HR bakes
 * into the employment NFT. That is the *whole* job: eSahod never asks a wallet
 * to sign a payroll transaction, because `paySalary` is signature-free — the
 * covenant enforces the split, so nobody holds the button.
 *
 * That property drives the design of this module: **the wallet is optional
 * everywhere.** Every screen must render, and payroll must run, with no
 * `VITE_WC_PROJECT_ID` configured, no wallet connected, and no network. So:
 *
 *  - nothing here touches WalletConnect, `window`, or the network at import
 *    time — the SDK is loaded by `await import(...)` on the first click, which
 *    also keeps it out of the main bundle;
 *  - a missing/blank project id is a first-class `unconfigured` state, not an
 *    error and never a throw;
 *  - every failure path lands back in `disconnected` with a readable message.
 *
 * ## Configuration
 *
 * `VITE_WC_PROJECT_ID` — a WalletConnect Cloud project id, free at
 * https://cloud.walletconnect.com. Put it in `app/.env.local` (gitignored):
 *
 * ```
 * VITE_WC_PROJECT_ID=your_project_id_here
 * ```
 *
 * Restart `npm run dev` after changing it — Vite inlines `import.meta.env.*`
 * at build time. Leave it unset and the app still runs end to end; the Connect
 * button simply explains that it is unset.
 */

/** WalletConnect Cloud project id, or '' when unset. Inlined by Vite. */
const PROJECT_ID: string =
  typeof import.meta.env.VITE_WC_PROJECT_ID === 'string'
    ? import.meta.env.VITE_WC_PROJECT_ID.trim()
    : '';

/** CAIP-2 chain id. eSahod deploys to chipnet, which speaks the testnet id. */
export const BCH_CHAIN = 'bch:bchtest';

/**
 * The BCH namespace as Paytaca advertises it. `bch_getAddresses` is the only
 * method eSahod actually calls; the two signing methods are requested so the
 * same session can later sign a *withdrawal* the employee initiates — never a
 * payroll run.
 */
const BCH_NAMESPACE = {
  bch: {
    chains: [BCH_CHAIN],
    methods: ['bch_getAddresses', 'bch_signTransaction', 'bch_signMessage'],
    events: ['addressesChanged'],
  },
};

const NO_PROJECT_ID =
  'WalletConnect is not configured — set VITE_WC_PROJECT_ID in app/.env.local ' +
  '(free project id at cloud.walletconnect.com) and restart the dev server. ' +
  'Everything else on this page works without it.';

// ── State ────────────────────────────────────────────────────────────────

export interface WalletAccount {
  /** The cash address exactly as the wallet returned it. */
  readonly address: string;
  /** hash160 of the employee's pubkey — what the NFT commitment carries. */
  readonly pkh: Uint8Array;
  /** The same 20 bytes as 40 lowercase hex chars, ready to paste into HR. */
  readonly pkhHex: string;
}

export type WalletState =
  /** No project id — the connect button is inert and says why. */
  | { readonly status: 'unconfigured'; readonly detail: string }
  /** Ready to connect. `detail` carries the reason we are back here, if any. */
  | { readonly status: 'disconnected'; readonly detail: string | null }
  /** Session proposal in flight; `uri` is the wc: pairing URI once issued. */
  | { readonly status: 'connecting'; readonly uri: string | null; readonly detail: string }
  | { readonly status: 'connected'; readonly account: WalletAccount };

const initialState: WalletState =
  PROJECT_ID === ''
    ? { status: 'unconfigured', detail: NO_PROJECT_ID }
    : { status: 'disconnected', detail: null };

let state: WalletState = initialState;
const listeners = new Set<() => void>();

function setState(next: WalletState): void {
  state = next;
  for (const listener of [...listeners]) listener();
}

export function getWalletState(): WalletState {
  return state;
}

export function subscribeWallet(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Subscribe a screen to the wallet. Safe on every screen, wallet or not. */
export function useWallet(): WalletState {
  return useSyncExternalStore(subscribeWallet, getWalletState, getWalletState);
}

/** The connected employee's PKH as hex, or null — what HR pre-fills from. */
export function connectedPkhHex(): string | null {
  return state.status === 'connected' ? state.account.pkhHex : null;
}

// ── The client, loaded lazily and kept alive across connects ─────────────

type SignClient = Awaited<
  ReturnType<typeof import('@walletconnect/sign-client').SignClient.init>
>;

let clientPromise: Promise<SignClient> | null = null;
let activeTopic: string | null = null;

/**
 * Every connect/cancel/disconnect bumps this. An in-flight attempt checks it
 * after each await and goes quiet once superseded, so a request the employee
 * already cancelled can never wake up later and re-connect the UI.
 */
let attemptId = 0;

async function getClient(): Promise<SignClient> {
  if (clientPromise === null) {
    clientPromise = (async () => {
      const { SignClient } = await import('@walletconnect/sign-client');
      const client = await SignClient.init({
        projectId: PROJECT_ID,
        metadata: {
          name: 'eSahod',
          description:
            'Automated Philippine private-sector payroll on Bitcoin Cash — net pay and every statutory remittance in one atomic transaction.',
          url: window.location.origin,
          icons: [],
        },
      });
      attachListeners(client);
      return client;
    })().catch((thrown: unknown) => {
      // Let the next click retry from scratch rather than caching the failure.
      clientPromise = null;
      throw thrown;
    });
  }
  return clientPromise;
}

function attachListeners(client: SignClient): void {
  client.on('session_delete', ({ topic }) => {
    if (topic !== activeTopic) return;
    activeTopic = null;
    setState({ status: 'disconnected', detail: 'Paytaca ended the session.' });
  });

  client.on('session_event', ({ topic, params }) => {
    if (topic !== activeTopic || params.event.name !== 'addressesChanged') return;
    // The wallet switched accounts — re-derive the PKH from the new address.
    const attempt = ++attemptId;
    void loadAccount(client, topic, attempt).catch((thrown: unknown) => {
      if (attempt === attemptId) {
        setState({ status: 'disconnected', detail: describe(thrown) });
      }
    });
  });

  client.on('session_expire', ({ topic }) => {
    if (topic !== activeTopic) return;
    activeTopic = null;
    setState({ status: 'disconnected', detail: 'The Paytaca session expired.' });
  });
}

// ── Actions ──────────────────────────────────────────────────────────────

/**
 * Connect (or re-adopt) a Paytaca session and derive the employee's PKH.
 * Never throws: every outcome is reported through `WalletState`.
 */
export async function connectPaytaca(): Promise<void> {
  if (PROJECT_ID === '') {
    setState({ status: 'unconfigured', detail: NO_PROJECT_ID });
    return;
  }
  if (state.status === 'connecting') return;

  const attempt = ++attemptId;
  setState({ status: 'connecting', uri: null, detail: 'Starting WalletConnect…' });
  try {
    const client = await getClient();
    if (attempt !== attemptId) return;

    // A page reload drops our in-memory state but not the relay session, so
    // reuse a live one instead of making the employee scan a second time.
    const existing = client.session
      .getAll()
      .find((session) => session.namespaces['bch'] !== undefined);
    if (existing !== undefined) {
      setState({ status: 'connecting', uri: null, detail: 'Resuming your Paytaca session…' });
      await loadAccount(client, existing.topic, attempt);
      return;
    }

    const { uri, approval } = await client.connect({ requiredNamespaces: BCH_NAMESPACE });
    if (attempt !== attemptId) return;
    setState({
      status: 'connecting',
      uri: uri ?? null,
      detail:
        uri === undefined
          ? 'Waiting for Paytaca to approve…'
          : 'Open Paytaca and approve the session request.',
    });

    const session = await approval();
    if (attempt !== attemptId) return;
    await loadAccount(client, session.topic, attempt);
  } catch (thrown) {
    if (attempt !== attemptId) return;
    activeTopic = null;
    setState({ status: 'disconnected', detail: describe(thrown) });
  }
}

/** Abandon a pending session proposal and return to a usable disconnected UI. */
export function cancelPaytaca(): void {
  attemptId += 1;
  activeTopic = null;
  setState({ status: 'disconnected', detail: 'Connection cancelled.' });
}

/**
 * Drop the session. Resets the UI first and best-effort tells the relay after,
 * so the button works even with the relay unreachable — the point of this
 * control in the demo is that disconnecting changes nothing about payroll.
 */
export async function disconnectPaytaca(): Promise<void> {
  const topic = activeTopic;
  attemptId += 1;
  activeTopic = null;
  setState({
    status: 'disconnected',
    detail: 'Wallet disconnected — payroll still runs, because paySalary needs no signature.',
  });

  if (topic === null || clientPromise === null) return;
  try {
    const client = await clientPromise;
    await client.disconnect({
      topic,
      reason: { code: 6000, message: 'eSahod: employee disconnected.' },
    });
  } catch {
    // The session is already gone from our side; nothing left to report.
  }
}

/** Ask the wallet for an address and turn it into the payee PKH. */
async function loadAccount(client: SignClient, topic: string, attempt: number): Promise<void> {
  activeTopic = topic;
  // `bch_getAddresses` takes no arguments; JSON-RPC by-position, hence [].
  const response = await client.request<unknown>({
    topic,
    chainId: BCH_CHAIN,
    request: { method: 'bch_getAddresses', params: [] },
  });
  if (attempt !== attemptId) return;

  const address = firstAddress(response);
  const pkh = cashAddressToPkh(address);
  setState({ status: 'connected', account: { address, pkh, pkhHex: bytesToHex(pkh) } });
}

// ── Response shapes ──────────────────────────────────────────────────────

/**
 * Pull the first cash address out of a `bch_getAddresses` result. Wallets
 * differ on the envelope — a bare string, `string[]`, `{ address }[]`, or
 * `{ addresses: [...] }` are all seen in the wild — so accept all of them and
 * fail loudly (with the raw payload) on anything else, rather than guessing.
 */
function firstAddress(response: unknown): string {
  if (typeof response === 'string' && response !== '') return response;

  if (Array.isArray(response)) {
    for (const entry of response) {
      if (typeof entry === 'string' && entry !== '') return entry;
      if (isRecord(entry) && typeof entry['address'] === 'string') return entry['address'];
    }
  } else if (isRecord(response)) {
    if (response['addresses'] !== undefined) return firstAddress(response['addresses']);
    if (typeof response['address'] === 'string') return response['address'];
  }

  throw new Error(`Paytaca returned no usable address (got ${preview(response)}).`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function preview(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

/** Turn anything thrown by the SDK into a sentence a demo audience can read. */
function describe(thrown: unknown): string {
  if (thrown instanceof Error) {
    const message = thrown.message.trim();
    if (/rejected|declined|denied/i.test(message)) return 'Paytaca rejected the connection.';
    if (/expired|timeout|timed out/i.test(message)) return 'The connection request timed out.';
    return message === '' ? 'WalletConnect failed for an unknown reason.' : message;
  }
  return typeof thrown === 'string' && thrown !== ''
    ? thrown
    : 'WalletConnect failed for an unknown reason.';
}
