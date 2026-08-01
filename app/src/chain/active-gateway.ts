import { useEffect, useState } from 'react'
import type { ChainGateway } from './gateway'
import { chainGateway as mockGateway } from './mock-chain-gateway'
import { chipnetConfigFromEnv, ChipnetChainGateway } from './chipnet-gateway'

/**
 * Which chain the app is talking to, and the switch between them.
 *
 * Chipnet is opt-in: with no `VITE_ESAHOD_*` variables set, the app runs on
 * the in-memory mock exactly as before, so a fresh clone needs no setup. Set
 * the four values that `scripts/esahod/01-deploy.ts` writes into
 * `deployment.json` and the same screens read real UTXOs instead.
 *
 * `cashscript` is imported dynamically for one reason worth stating: it pulls
 * roughly 380 kB into the bundle, and a demo running on the mock should not
 * download an Electrum client it will never open. The import happens only
 * after the config check passes.
 */

export type ChainMode =
  | { readonly kind: 'mock' }
  | { readonly kind: 'connecting' }
  | { readonly kind: 'chipnet'; readonly treasuryAddress: string }
  | { readonly kind: 'error'; readonly detail: string }

let mode: ChainMode = chipnetConfigFromEnv() === null ? { kind: 'mock' } : { kind: 'connecting' }
let active: ChainGateway = mockGateway
const listeners = new Set<() => void>()

function publish(next: ChainMode, gateway: ChainGateway): void {
  mode = next
  active = gateway
  for (const listener of listeners) listener()
}

/**
 * Attempted once at module load. A failure here is not fatal: the app falls
 * back to the mock and says so, rather than rendering an empty payroll and
 * leaving someone to guess whether the company simply has no employees.
 */
async function connect(): Promise<void> {
  const config = chipnetConfigFromEnv()
  if (config === null) return

  try {
    const { ElectrumNetworkProvider, Network } = await import('cashscript')
    const provider = new ElectrumNetworkProvider(Network.CHIPNET)
    const gateway = new ChipnetChainGateway(provider, config)

    // Prove the connection before switching: an address that resolves is the
    // difference between "connected" and "constructed an object".
    await gateway.getTreasury()

    publish({ kind: 'chipnet', treasuryAddress: config.treasuryAddress }, gateway)
  } catch (error) {
    publish(
      { kind: 'error', detail: error instanceof Error ? error.message : String(error) },
      mockGateway,
    )
  }
}

void connect()

export function activeGateway(): ChainGateway {
  return active
}

/** Subscribe a component to which chain is in use. */
export function useChainMode(): ChainMode {
  const [current, setCurrent] = useState<ChainMode>(mode)

  useEffect(() => {
    const listener = (): void => setCurrent(mode)
    listeners.add(listener)
    listener()

    return () => {
      listeners.delete(listener)
    }
  }, [])

  return current
}
