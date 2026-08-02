import {
  FIXTURES,
  computeDeductions,
  fixtureFullName,
  commitmentFromHex,
  commitmentToHex,
  decodeCommitment,
  outputLayoutFor,
} from '@domain/index'
import type { Deductions } from '@domain/statutory/deductions'
import { bytesToHex } from '../lib/format'
import { supabase } from '../data/supabase'
import type {
  AmendAction,
  AmendResult,
  ChainGateway,
  EmployeeRecord,
  PayrollRun,
  TreasurySnapshot,
  TxOutput,
} from './gateway'

/**
 * The read-only chipnet adapter.
 *
 * Same `ChainGateway` interface the mock implements, so no screen changes: the
 * treasury balance, the employment records and their period counters come from
 * real UTXOs at the deployed covenant addresses instead of from memory.
 *
 * ══ HOW THIS WRITES, GIVEN THE BROWSER HOLDS NO KEY ═════════════════════
 *
 * `paySalary` needs no signature — that is the covenant's whole point. But the
 * transaction still has to pay a mining fee and fund the dust on five
 * disbursement outputs, and the covenant deliberately forbids either of its own
 * inputs from covering that:
 *
 *     require(tx.outputs[changeOut].value >= tx.inputs[0].value,
 *             "the treasury must keep its satoshis");
 *
 * Without that line a "payroll" could pay the right pesos to the right people
 * while draining the treasury's BCH as fees. So a fee input is structural, and
 * fee inputs are ordinary P2PKH coins that must be signed.
 *
 * The browser is the wrong place for that key — it is shared with every page
 * the user has open. So these two methods POST to the keeper relay
 * (`scripts/esahod/keeper-relay.ts`), which holds the fee key and broadcasts.
 *
 * What that relay can do is bounded by the covenant, not by trust in the relay:
 * every payee address, token category and amount is pinned and computed from
 * the employee's own 40-byte record. A compromised relay can refuse to pay, or
 * pay a different employee than was asked for. It cannot change who gets paid
 * or how much, and it cannot take anything.
 *
 * `amend` is not like that — HR's key rewrites pay terms — so the relay serves
 * it only when explicitly given that key, and says so on `/health`.
 *
 * With no relay configured this adapter stays read-only and both methods
 * explain what is missing rather than failing obscurely.
 *
 * ══ WHAT IS NOT ON CHAIN ════════════════════════════════════════════════
 *
 * Names and positions. The 40-byte commitment carries `employeeNo` and no
 * room for anything else, so a record read back from the vault knows it is
 * employee #1001 and nothing more. Those are HRIS fields; a real deployment
 * joins them from its own database. Here they come from the fixtures, and an
 * unknown number falls back to "Employee #N" rather than inventing a person.
 *
 * Payslip history, likewise. Reconstructing it means walking the address's
 * transaction history and decoding each payroll transaction — genuinely
 * possible, and out of scope for a read-only view whose job is to show
 * current state.
 */

export interface ChipnetConfig {
  readonly treasuryAddress: string
  readonly vaultAddress: string
  /** Category of the fungible ePHP token, display order. */
  readonly pesoCategory: string
  /** Category of the employment NFTs, display order. */
  readonly employmentCategory: string
}

/**
 * Reads the deployment written by `scripts/esahod/01-deploy.ts`, passed in
 * through Vite env vars. Absent config means the app stays on the mock — the
 * chipnet path is opt-in, so a fresh clone still runs with no setup.
 */
export function chipnetConfigFromEnv(): ChipnetConfig | null {
  const env = import.meta.env
  const treasuryAddress = env.VITE_ESAHOD_TREASURY_ADDRESS
  const vaultAddress = env.VITE_ESAHOD_VAULT_ADDRESS
  const pesoCategory = env.VITE_ESAHOD_PESO_CATEGORY
  const employmentCategory = env.VITE_ESAHOD_EMPLOYMENT_CATEGORY

  if (!treasuryAddress || !vaultAddress || !pesoCategory || !employmentCategory) return null

  return { treasuryAddress, vaultAddress, pesoCategory, employmentCategory }
}

/** Minimal shape of what the provider returns, to avoid importing its types eagerly. */
interface ChainUtxo {
  readonly satoshis: bigint
  readonly token?: {
    readonly amount: bigint
    readonly category: string
    readonly nft?: { readonly capability: string; readonly commitment: string }
  }
}

interface Provider {
  getUtxos(address: string): Promise<ChainUtxo[]>
}

const NO_RELAY =
  'No keeper relay is configured, so this build reads chipnet but cannot write to it. Start scripts/esahod/keeper-relay.ts and set VITE_ESAHOD_RELAY_URL, or run the payroll from scripts/esahod/03-run-payroll.ts and this screen will show the result.'

/** Where the keeper relay is listening, or null when writes are not available. */
export function relayUrl(): string | null {
  const configured = import.meta.env.VITE_ESAHOD_RELAY_URL

  return configured === undefined || configured === '' ? null : configured.replace(/\/$/, '')
}

/**
 * Call the keeper relay with the caller's own Supabase session.
 *
 * The token is the user's, not a shared secret: the relay asks Supabase who
 * they are and reads their role from `profiles`. Nothing about the caller's
 * authority travels in the body, where it would be a claim rather than a fact.
 */
async function relay<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const base = relayUrl()
  if (base === null) throw new Error(NO_RELAY)

  const client = supabase()
  const { data } = (await client?.auth.getSession()) ?? { data: { session: null } }
  const token = data.session?.access_token

  if (token === undefined) {
    throw new Error('Sign in with a Supabase account to write to the chain — the relay needs to know who is asking.')
  }

  let response: Response
  try {
    response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
  } catch {
    // A dead relay is the likeliest failure in a demo, and "Failed to fetch"
    // says nothing an operator can act on.
    throw new Error(`The keeper relay at ${base} is not reachable. Is it running?`)
  }

  const payload = (await response.json().catch(() => ({}))) as { error?: string } & T
  if (!response.ok) throw new Error(payload.error ?? `The relay refused this (HTTP ${response.status}).`)

  return payload
}

/** The seven outputs the covenant pins, for the screen that draws them. */
function chipnetOutputs(
  employee: EmployeeRecord,
  deductions: Deductions,
  config: ChipnetConfig,
): readonly TxOutput[] {
  const remit = (index: number, kind: TxOutput['kind'], label: string, ephp: bigint, detail: string): TxOutput => ({
    index,
    kind,
    label,
    recipient: 'pinned by the covenant',
    ephp,
    detail,
  })

  return [
    {
      index: 0,
      kind: 'net',
      label: `${employee.name} — net pay`,
      recipient: bytesToHex(employee.commitment.payeePkh),
      ephp: deductions.net,
      detail: 'the payee hash inside the employment record',
    },
    remit(1, 'sss', 'SSS', deductions.sssEE + deductions.sssER + deductions.sssEC, 'employee + employer + EC'),
    remit(2, 'philhealth', 'PhilHealth', deductions.phicEE + deductions.phicER, 'employee + employer'),
    remit(3, 'pagibig', 'Pag-IBIG', deductions.hdmfEE + deductions.hdmfER, 'employee + employer'),
    remit(4, 'bir', 'BIR', deductions.tax, 'withholding tax'),
    {
      index: 5,
      kind: 'nft',
      label: 'Employment record, period advanced',
      recipient: config.vaultAddress,
      ephp: null,
      detail: `period ${employee.commitment.nextPeriod} → ${employee.commitment.nextPeriod + 1}`,
    },
    {
      index: 6,
      kind: 'change',
      label: 'Treasury change',
      recipient: config.treasuryAddress,
      ephp: null,
      detail: 'the remainder, back under the covenant',
    },
  ]
}

export class ChipnetChainGateway implements ChainGateway {
  private readonly listeners = new Set<() => void>()
  private timer: ReturnType<typeof setInterval> | undefined

  constructor(
    private readonly provider: Provider,
    private readonly config: ChipnetConfig,
    /** How often to re-read the chain, ms. */
    private readonly pollMs = 10_000,
  ) {}

  async getTreasury(): Promise<TreasurySnapshot> {
    const utxos = await this.provider.getUtxos(this.config.treasuryAddress)
    const ephpBalance = utxos
      .filter((utxo) => utxo.token?.category === this.config.pesoCategory)
      .reduce((total, utxo) => total + (utxo.token?.amount ?? 0n), 0n)

    return {
      ephpBalance,
      tokenCategory: this.config.pesoCategory,
      address: this.config.treasuryAddress,
      // Would need the address's transaction history to count truthfully, and
      // reporting a guess as a count is worse than reporting nothing.
      runCount: 0,
    }
  }

  async getEmployees(): Promise<readonly EmployeeRecord[]> {
    const utxos = await this.provider.getUtxos(this.config.vaultAddress)

    return utxos
      .filter(
        (utxo) =>
          utxo.token?.category === this.config.employmentCategory &&
          utxo.token.nft?.capability === 'mutable' &&
          typeof utxo.token.nft.commitment === 'string' &&
          utxo.token.nft.commitment.length > 0,
      )
      .map((utxo) => {
        const hex = utxo.token!.nft!.commitment
        const commitment = decodeCommitment(commitmentFromHex(hex))
        const fixture = FIXTURES.find((entry) => entry.employeeNo === commitment.employeeNo)

        return {
          employeeNo: commitment.employeeNo,
          name: fixture ? fixtureFullName(fixture) : `Employee #${commitment.employeeNo}`,
          position: fixture?.position ?? 'On-chain record',
          commitment,
          commitmentHex: commitmentToHex(commitmentFromHex(hex)),
          history: [],
        }
      })
      .sort((a, b) => a.employeeNo - b.employeeNo)
  }

  async runPayroll(employeeNo: number): Promise<PayrollRun> {
    const before = await this.getTreasury()
    const employees = await this.getEmployees()
    const employee = employees.find((candidate) => candidate.employeeNo === employeeNo)
    if (!employee) throw new Error(`No employment record on chain for employee #${employeeNo}`)

    const { txid } = await relay<{ txid: string; period: number }>('/payroll', { employeeNo })

    // Deductions are recomputed here rather than returned by the relay, so the
    // figures on screen come from the same engine the covenant was matched
    // against. If the relay were to report different numbers, the ones shown
    // would still be the ones the chain enforced.
    const deductions = computeDeductions({
      monthlyBasic: employee.commitment.monthlyBasic,
      monthlyAllowance: employee.commitment.monthlyAllowance,
      taxPerPeriod: employee.commitment.taxPerPeriod,
    })

    const after = await this.getTreasury()
    this.notify()

    return {
      txid,
      employeeNo,
      employeeName: employee.name,
      period: employee.commitment.nextPeriod,
      executedAt: Date.now(),
      deductions,
      layout: outputLayoutFor(employee.commitment.taxPerPeriod),
      outputs: chipnetOutputs(employee, deductions, this.config),
      treasuryBefore: before.ephpBalance,
      treasuryAfter: after.ephpBalance,
    }
  }

  async amend(employeeNo: number, action: AmendAction): Promise<AmendResult> {
    const employees = await this.getEmployees()
    const employee = employees.find((candidate) => candidate.employeeNo === employeeNo)
    if (!employee) throw new Error(`No employment record on chain for employee #${employeeNo}`)

    await relay<{ txid: string }>('/amend', {
      employeeNo,
      kind: action.kind,
      ...(action.kind === 'terms'
        ? {
            monthlyBasic: action.monthlyBasic.toString(),
            monthlyAllowance: action.monthlyAllowance.toString(),
            taxPerPeriod: action.taxPerPeriod.toString(),
          }
        : {}),
    })

    // Read the record back from the chain rather than predicting it. The
    // covenant may legitimately refuse part of an amendment, and showing what
    // was asked for instead of what happened is how a UI starts lying.
    const refreshed = (await this.getEmployees()).find((c) => c.employeeNo === employeeNo)
    if (!refreshed) throw new Error('The record vanished from the vault after amending.')

    this.notify()

    return {
      employeeNo,
      action: action.kind,
      before: employee.commitment,
      after: refreshed.commitment,
      beforeHex: employee.commitmentHex,
      afterHex: refreshed.commitmentHex,
    }
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }

  /**
   * Polling, not a subscription. Electrum can push address notifications, but
   * a poll is honest about its latency and cannot leave the UI wedged on a
   * dropped socket — the failure mode that matters when this is on a projector.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)

    this.timer ??= setInterval(() => {
      for (const entry of this.listeners) entry()
    }, this.pollMs)

    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0 && this.timer !== undefined) {
        clearInterval(this.timer)
        this.timer = undefined
      }
    }
  }
}
