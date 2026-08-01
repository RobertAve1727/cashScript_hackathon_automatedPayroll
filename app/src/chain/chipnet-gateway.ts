import { FIXTURES, commitmentFromHex, commitmentToHex, decodeCommitment } from '@domain/index'
import type { AmendAction, ChainGateway, EmployeeRecord, PayrollRun, TreasurySnapshot } from './gateway'

/**
 * The read-only chipnet adapter.
 *
 * Same `ChainGateway` interface the mock implements, so no screen changes: the
 * treasury balance, the employment records and their period counters come from
 * real UTXOs at the deployed covenant addresses instead of from memory.
 *
 * ══ READ-ONLY, AND WHY ══════════════════════════════════════════════════
 *
 * `runPayroll` and `amend` throw. Not because building those transactions is
 * hard — `buildPaySalaryTransaction` already does it, and it is the same code
 * the tests drive — but because both need a SIGNATURE, and the browser is the
 * wrong place to hold the key.
 *
 * `paySalary` itself needs no signature; that is the covenant's whole point.
 * But the transaction still needs a fee input, and fee inputs are ordinary
 * P2PKH coins that must be signed. `amend` additionally needs HR's key. So the
 * options are a private key in the bundle — which would undo the trust story
 * this project is built on — or Paytaca signing over WalletConnect, which is
 * real work and a live dependency mid-demo.
 *
 * Until that exists, writes belong in `scripts/esahod/`, run from a terminal
 * by someone holding the keys. This adapter shows the result.
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

const WRITE_MESSAGE =
  'This build reads chipnet but cannot write to it: signing a fee input needs a key, and the browser is the wrong place for one. Run the payroll from scripts/esahod/03-run-payroll.ts and this screen will show the result.'

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
          name: fixture?.name ?? `Employee #${commitment.employeeNo}`,
          position: fixture?.position ?? 'On-chain record',
          commitment,
          commitmentHex: commitmentToHex(commitmentFromHex(hex)),
          history: [],
        }
      })
      .sort((a, b) => a.employeeNo - b.employeeNo)
  }

  runPayroll(_employeeNo: number): Promise<PayrollRun> {
    return Promise.reject(new Error(WRITE_MESSAGE))
  }

  amend(_employeeNo: number, _action: AmendAction): Promise<AmendResult> {
    return Promise.reject(new Error(WRITE_MESSAGE))
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

// Re-exported so the module does not need the gateway's own import for one type.
type AmendResult = Awaited<ReturnType<ChainGateway['amend']>>
