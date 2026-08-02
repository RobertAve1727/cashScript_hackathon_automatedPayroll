#!/usr/bin/env node
/**
 * The keeper relay — how the app writes to the chain.
 *
 * Run: npx tsx scripts/esahod/keeper-relay.ts
 *
 * ══ WHY A SIGNATURE IS NEEDED AT ALL, WHEN paySalary NEEDS NONE ═════════
 *
 * `paySalary` really does take no signature; that is the covenant's whole
 * point. But a transaction still has to pay a mining fee and fund the dust on
 * five disbursement outputs, and the covenant deliberately refuses to let
 * either of its own inputs cover that:
 *
 *     require(tx.outputs[changeOut].value >= tx.inputs[0].value,
 *             "the treasury must keep its satoshis");
 *     require(tx.outputs[nftOut].value >= tx.inputs[1].value,
 *             "the employment record must keep its satoshis");
 *
 * Without those two lines a "payroll" transaction could pay the right pesos to
 * the right people while quietly draining the treasury's BCH as fees. So the
 * fee comes from an ordinary P2PKH coin, and ordinary coins need signing.
 *
 * That signature is the only reason this process exists.
 *
 * ══ WHAT THIS KEY CAN AND CANNOT DO ═════════════════════════════════════
 *
 * The keeper key pays fees. That is the complete list of its powers.
 *
 * It cannot redirect a peso: every payee address, token category and amount in
 * a payroll transaction is pinned by the covenant and computed from the
 * employee's own 40-byte record. Someone who steals this key can waste the fee
 * coins it holds — a fraction of a centavo each — and nothing else. Someone who
 * compromises this whole process can refuse to run payroll, or run it for a
 * different employee than was asked for; they still cannot change who gets paid
 * or how much.
 *
 * That is why it is safe to put this behind a web request, and why it would not
 * be safe to put a key in the browser bundle instead: the browser is shared with
 * every page the user has open, and a key there is a key anyone can read.
 *
 * ══ THE HR KEY IS NOT LIKE THE FEE KEY ══════════════════════════════════
 *
 * `/amend` is different and the difference is not cosmetic. HR's key rewrites
 * pay terms — salary, tax, status — so a relay holding it CAN do harm. It is
 * therefore opt-in: without `ESAHOD_HR_WIF` this relay serves payroll only and
 * says so at startup. Enabling it is a real trust concession and is stated here
 * rather than buried.
 *
 * A production deployment would sign amendments in HR's own wallet over
 * WalletConnect and never let this process hold that key.
 *
 * ══ WHO MAY CALL IT ═════════════════════════════════════════════════════
 *
 * The caller presents their Supabase session token. The relay asks Supabase who
 * they are and reads their role from `profiles` — it never trusts a role sent in
 * the request body. Payroll needs `payroll_officer` or `hr`; amendment needs
 * `hr`.
 *
 * Strictly speaking payroll needs no permission at all — anyone may broadcast
 * `paySalary`, and an employee running it for themselves is the design working.
 * The check here is not protecting the money; it is protecting the keeper's fee
 * coins from being drained by strangers.
 */
import { hexToBin } from '@bitauth/libauth';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { TransactionBuilder } from 'cashscript';
import { decodeCommitment, encodeCommitment } from '../../src/domain/index.js';
import { deployEsahod } from '../../src/infrastructure/blockchain/esahod/addresses.js';
import { buildPaySalaryTransaction } from '../../src/infrastructure/blockchain/esahod/payroll-transaction.js';
import { chipnetProvider, keyFromWif, pkhOf, readDeployment, requireEnv, selectFeeUtxos, toBytes20 } from './lib/config.js';

const PORT = Number(process.env['ESAHOD_RELAY_PORT'] ?? 8787);

/**
 * Which origins may call this. A relay that answered `*` would let any page the
 * operator has open spend the keeper's fee coins.
 */
const ALLOWED_ORIGINS = (process.env['ESAHOD_RELAY_ORIGINS'] ?? 'http://localhost:4173,http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim());

interface Caller {
  readonly id: string;
  readonly role: 'hr' | 'payroll_officer' | 'employee';
}

/**
 * Who is calling, according to Supabase — not according to the request.
 *
 * Two round trips on purpose. The first proves the token is a live session; the
 * second reads the role from `profiles`, which row-level security already
 * restricts to the caller's own row. A role claim inside a JWT would be faster
 * and would be a claim the client could influence.
 */
async function authenticate(token: string | undefined): Promise<Caller | null> {
  if (token === undefined || token === '') return null;

  const url = requireEnv('SUPABASE_URL');
  const anonKey = requireEnv('SUPABASE_ANON_KEY');
  const headers = { Authorization: `Bearer ${token}`, apikey: anonKey };

  const userResponse = await fetch(`${url}/auth/v1/user`, { headers });
  if (!userResponse.ok) return null;

  const user = (await userResponse.json()) as { id?: string };
  if (user.id === undefined) return null;

  const profileResponse = await fetch(
    `${url}/rest/v1/profiles?id=eq.${user.id}&select=role`,
    { headers },
  );
  if (!profileResponse.ok) return null;

  const [profile] = (await profileResponse.json()) as { role?: Caller['role'] }[];
  if (profile?.role === undefined) return null;

  return { id: user.id, role: profile.role };
}

/** Rebuild both covenants and refuse to continue if they are not the deployed ones. */
async function connect() {
  const deployment = await readDeployment();
  if (deployment.employmentCategory === undefined || deployment.pesoCategory === undefined) {
    throw new Error('scripts/esahod/deployment.json is incomplete — run 01-deploy.ts');
  }

  const officer = keyFromWif(requireEnv('ESAHOD_OFFICER_WIF'));
  const provider = chipnetProvider();

  const deployed = deployEsahod(
    provider,
    {
      employmentCategory: hexToBin(deployment.employmentCategory),
      pesoCategory: hexToBin(deployment.pesoCategory),
      remitConfigHash: hexToBin(deployment.remitConfigHash ?? requireEnv('ESAHOD_REMIT_CONFIG_HASH')),
      genesisTime: BigInt(deployment.genesisTime ?? '0'),
      periodSeconds: BigInt(deployment.periodSeconds ?? '0'),
      payrollOfficerPkh: pkhOf(officer),
      lapseTime: BigInt(deployment.lapseTime ?? '0'),
    },
    toBytes20(deployment.hrPkh ?? requireEnv('ESAHOD_HR_PKH')),
  );

  // Both contracts are addressed by hashing their constructor arguments, so a
  // single wrong argument produces a valid-looking contract at an address
  // holding no money. Better to refuse here than to broadcast a spend of a
  // treasury that does not exist.
  //
  // Either encoding counts as a match. A contract has two cashaddr forms for
  // one script hash — token-aware (`r…`) and plain (`p…`) — and they differ
  // only in a version byte and checksum. Comparing against one form alone
  // rejects a contract that is provably the right one, which is a worse
  // failure than the one this check exists to catch: it stops a correct
  // payroll for a reason that sounds like corruption.
  const matches = (contract: { address: string; tokenAddress: string }, recorded: string | undefined): boolean =>
    recorded === contract.address || recorded === contract.tokenAddress;

  if (!matches(deployed.treasury, deployment.treasuryAddress)) {
    throw new Error(
      `rebuilt treasury ${deployed.treasury.address} does not match the deployed ${deployment.treasuryAddress} — a constructor argument is wrong`,
    );
  }
  if (!matches(deployed.vault, deployment.vaultAddress)) {
    throw new Error(
      `rebuilt vault ${deployed.vault.address} does not match the deployed ${deployment.vaultAddress}`,
    );
  }

  return { deployment, provider, deployed };
}

/** The employment record whose commitment carries this employee number. */
async function findRecord(deployed: Awaited<ReturnType<typeof connect>>['deployed'], employeeNo: number) {
  const utxos = await deployed.vault.getUtxos();

  return utxos.find((utxo) => {
    const commitment = utxo.token?.nft?.commitment;
    if (commitment === undefined || commitment === '') return false;

    try {
      return decodeCommitment(hexToBin(commitment)).employeeNo === employeeNo;
    } catch {
      return false;
    }
  });
}

async function runPayroll(employeeNo: number): Promise<{ txid: string; period: number }> {
  const { deployment, provider, deployed } = await connect();

  const [treasuryUtxo] = await deployed.treasury.getUtxos();
  if (treasuryUtxo === undefined) throw new Error('the treasury holds no funds — nothing to pay from');

  const nftUtxo = await findRecord(deployed, employeeNo);
  if (nftUtxo === undefined) throw new Error(`no employment record in the vault for employee #${employeeNo}`);

  const commitment = decodeCommitment(hexToBin(nftUtxo.token!.nft!.commitment));

  const keeper = keyFromWif(requireEnv('ESAHOD_KEEPER_WIF'));
  const feeLockingBytecode = keeper.unlockP2PKH().generateLockingBytecode();
  const feeUtxos = selectFeeUtxos(await provider.getUtxosForLockingBytecode(feeLockingBytecode));

  const builder = buildPaySalaryTransaction({
    provider,
    treasury: deployed.treasury,
    vault: deployed.vault,
    treasuryUtxo,
    nftUtxo,
    feeUtxos,
    feeSigner: keeper,
    feeChangeAddress: feeLockingBytecode,
    remitConfig: {
      sssPkh: toBytes20(requireEnv('ESAHOD_SSS_PKH')),
      phicPkh: toBytes20(requireEnv('ESAHOD_PHIC_PKH')),
      hdmfPkh: toBytes20(requireEnv('ESAHOD_HDMF_PKH')),
      birPkh: toBytes20(requireEnv('ESAHOD_BIR_PKH')),
    },
    genesisTime: BigInt(deployment.genesisTime ?? '0'),
    periodSeconds: BigInt(deployment.periodSeconds ?? '0'),
  });

  const receipt = await builder.send();

  return { txid: receipt.txid, period: commitment.nextPeriod };
}

type AmendKind = 'terms' | 'suspend' | 'reinstate' | 'separate';

async function amend(
  employeeNo: number,
  action: { kind: AmendKind; monthlyBasic?: string; monthlyAllowance?: string; taxPerPeriod?: string },
): Promise<{ txid: string }> {
  const { deployment, provider, deployed } = await connect();

  const hr = keyFromWif(requireEnv('ESAHOD_HR_WIF'));
  const nftUtxo = await findRecord(deployed, employeeNo);
  if (nftUtxo === undefined) throw new Error(`no employment record in the vault for employee #${employeeNo}`);

  const current = decodeCommitment(hexToBin(nftUtxo.token!.nft!.commitment));

  const amended = encodeCommitment({
    payeePkh: current.payeePkh,
    monthlyBasic: action.monthlyBasic === undefined ? current.monthlyBasic : BigInt(action.monthlyBasic),
    monthlyAllowance:
      action.monthlyAllowance === undefined ? current.monthlyAllowance : BigInt(action.monthlyAllowance),
    taxPerPeriod: action.taxPerPeriod === undefined ? current.taxPerPeriod : BigInt(action.taxPerPeriod),
    // Never touched here. The covenant refuses to move it backwards, and only
    // paySalary advances it — an amendment that could rewind the counter would
    // reopen a period that has already been paid.
    nextPeriod: current.nextPeriod,
    endPeriod: action.kind === 'separate' ? current.nextPeriod : current.endPeriod,
    status: action.kind === 'suspend' || action.kind === 'separate' ? 0 : 1,
    employeeNo: current.employeeNo,
  });

  const keeper = keyFromWif(requireEnv('ESAHOD_KEEPER_WIF'));
  const feeLockingBytecode = keeper.unlockP2PKH().generateLockingBytecode();
  const feeUtxos = selectFeeUtxos(await provider.getUtxosForLockingBytecode(feeLockingBytecode));

  const builder = new TransactionBuilder({ provider });
  builder.addInput(nftUtxo, deployed.vault.unlock.amend(hr, hr.getPublicKey()));
  builder.addInputs([...feeUtxos], keeper.unlockP2PKH());
  builder.addOutput({
    to: hexToBin(deployment.vaultLockingBytecode!),
    amount: nftUtxo.satoshis,
    token: {
      category: nftUtxo.token!.category,
      amount: 0n,
      nft: { capability: 'mutable', commitment: Buffer.from(amended).toString('hex') },
    },
  });
  builder.addBchChangeOutputIfNeeded({ to: feeLockingBytecode, feeRate: 1 });

  const receipt = await builder.send();

  return { txid: receipt.txid };
}

// ── HTTP ─────────────────────────────────────────────────────────────────

function cors(request: IncomingMessage, response: ServerResponse): boolean {
  const origin = request.headers.origin;

  if (origin !== undefined && ALLOWED_ORIGINS.includes(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
  }
  response.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  response.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');

  if (request.method === 'OPTIONS') {
    response.writeHead(204).end();
    return true;
  }

  return false;
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

const hrEnabled = process.env['ESAHOD_HR_WIF'] !== undefined && process.env['ESAHOD_HR_WIF'] !== '';

const server = createServer((request, response) => {
  void (async () => {
    if (cors(request, response)) return;

    const path = new URL(request.url ?? '/', 'http://localhost').pathname;

    if (path === '/health') {
      send(response, 200, {
        service: 'esahod-keeper-relay',
        holds: hrEnabled ? ['fee key', 'HR key'] : ['fee key'],
        canRedirectPayments: false,
        note: 'Every payee and amount is pinned by the covenant. This key pays fees.',
        amendEnabled: hrEnabled,
      });
      return;
    }

    if (request.method !== 'POST') return send(response, 405, { error: 'POST only' });

    const caller = await authenticate(request.headers.authorization?.replace(/^Bearer\s+/i, ''));
    if (caller === null) return send(response, 401, { error: 'Sign in again — this session is not valid.' });

    const body = await readJson(request);
    const employeeNo = Number(body['employeeNo']);
    if (!Number.isInteger(employeeNo) || employeeNo <= 0) {
      return send(response, 400, { error: 'employeeNo must be a positive integer' });
    }

    try {
      if (path === '/payroll') {
        if (caller.role !== 'hr' && caller.role !== 'payroll_officer') {
          return send(response, 403, { error: 'Only HR or the payroll officer may spend the keeper’s fee coins.' });
        }

        console.log(`[payroll] employee #${employeeNo} requested by ${caller.role} ${caller.id}`);
        const result = await runPayroll(employeeNo);
        console.log(`[payroll] broadcast ${result.txid}`);

        return send(response, 200, result);
      }

      if (path === '/amend') {
        if (!hrEnabled) {
          return send(response, 501, {
            error: 'This relay does not hold an HR key. Amendments are signed from scripts/esahod/04-amend.ts.',
          });
        }
        if (caller.role !== 'hr') {
          return send(response, 403, { error: 'Only HR may amend an employment record.' });
        }

        console.log(`[amend] employee #${employeeNo} (${String(body['kind'])}) by ${caller.id}`);
        const result = await amend(employeeNo, {
          kind: body['kind'] as AmendKind,
          ...(typeof body['monthlyBasic'] === 'string' ? { monthlyBasic: body['monthlyBasic'] } : {}),
          ...(typeof body['monthlyAllowance'] === 'string' ? { monthlyAllowance: body['monthlyAllowance'] } : {}),
          ...(typeof body['taxPerPeriod'] === 'string' ? { taxPerPeriod: body['taxPerPeriod'] } : {}),
        });
        console.log(`[amend] broadcast ${result.txid}`);

        return send(response, 200, result);
      }

      return send(response, 404, { error: 'unknown endpoint' });
    } catch (thrown) {
      // The covenant's own require() messages are the most useful thing that can
      // come back here — "payday for this period has not arrived" tells an
      // operator exactly what happened. Pass them through rather than replacing
      // them with a generic failure.
      const message = thrown instanceof Error ? thrown.message : String(thrown);
      console.error(`[error] ${message}`);

      return send(response, 400, { error: message });
    }
  })();
});

server.listen(PORT, () => {
  console.log(`eSahod keeper relay on http://localhost:${PORT}`);
  console.log(`  origins allowed : ${ALLOWED_ORIGINS.join(', ')}`);
  console.log(`  payroll         : enabled (fee key only — cannot redirect a peso)`);
  console.log(
    hrEnabled
      ? '  amend           : ENABLED — this process holds HR’s key and can rewrite pay terms'
      : '  amend           : disabled (no ESAHOD_HR_WIF)',
  );
});
