import { useEffect, useState } from 'react';

import type { ChainGateway, EmployeeRecord, TreasurySnapshot } from './gateway';
import { activeGateway, useChainMode } from './active-gateway';

export interface ChainState {
  readonly treasury: TreasurySnapshot;
  readonly employees: readonly EmployeeRecord[];
}

/**
 * Subscribe a screen to chain state through the gateway seam. Works unchanged
 * whether the gateway is the in-memory mock or the chipnet adapter — the hook
 * only ever calls the `ChainGateway` interface.
 *
 * `useChainMode()` is read so the hook re-runs when the chipnet connection
 * resolves after boot; without it a screen mounted during `connecting` would
 * keep showing mock data after the real chain arrived.
 */
export function useChainState(override?: ChainGateway): ChainState | null {
  const [state, setState] = useState<ChainState | null>(null);
  const chainMode = useChainMode();
  const gateway = override ?? activeGateway();

  useEffect(() => {
    // While chipnet is configured but not yet answering, show nothing rather
    // than the mock's figures. The alternative is a second or two of seeded
    // demo numbers under a banner that says "connecting to chipnet", which
    // reads as real on-chain data and is the one thing this app must never do.
    if (chainMode.kind === 'connecting') {
      setState(null);
      return;
    }

    let alive = true;
    const refresh = (): void => {
      void Promise.all([gateway.getTreasury(), gateway.getEmployees()]).then(
        ([treasury, employees]) => {
          if (alive) setState({ treasury, employees });
        },
      );
    };
    refresh();
    const unsubscribe = gateway.subscribe(refresh);

    return () => {
      alive = false;
      unsubscribe();
    };
  }, [gateway, chainMode.kind]);

  return state;
}

/** Human-readable message from an unknown thrown value. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
