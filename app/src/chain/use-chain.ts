import { useEffect, useState } from 'react';

import type { ChainGateway, EmployeeRecord, TreasurySnapshot } from './gateway';
import { chainGateway } from './mock-chain-gateway';

export interface ChainState {
  readonly treasury: TreasurySnapshot;
  readonly employees: readonly EmployeeRecord[];
}

/**
 * Subscribe a screen to chain state through the gateway seam. Works unchanged
 * whether the gateway is the in-memory mock or a chipnet adapter — the hook
 * only ever calls the `ChainGateway` interface.
 */
export function useChainState(gateway: ChainGateway = chainGateway): ChainState | null {
  const [state, setState] = useState<ChainState | null>(null);

  useEffect(() => {
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
  }, [gateway]);

  return state;
}

/** Human-readable message from an unknown thrown value. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
