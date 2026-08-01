import { ElectrumNetworkProvider, MockNetworkProvider, Network, type NetworkProvider } from 'cashscript';
import { BchNetwork } from '../../domain/index.js';
import { ChainMode, type PayrollConfiguration } from '../config/payroll-configuration.js';

/**
 * The domain's three networks mapped onto the concrete chains CashScript talks
 * to. `testnet` resolves to testnet4, the network current BCH test faucets and
 * explorers actually serve.
 */
const CASHSCRIPT_NETWORKS: Readonly<Record<BchNetwork, Network>> = {
  [BchNetwork.Mainnet]: Network.MAINNET,
  [BchNetwork.Testnet]: Network.TESTNET4,
  [BchNetwork.Regtest]: Network.REGTEST,
};

export function toCashScriptNetwork(network: BchNetwork): Network {
  return CASHSCRIPT_NETWORKS[network];
}

/**
 * Chooses the chain the process talks to.
 *
 * `MockNetworkProvider` keeps an in-process UTXO set, so the entire settlement
 * path — build, sign, evaluate against the BCH VM, "broadcast" — runs in tests
 * and demos with no server and no money at risk.
 */
export function createNetworkProvider(config: PayrollConfiguration): NetworkProvider {
  if (config.chain === ChainMode.Mock) {
    return new MockNetworkProvider();
  }

  return new ElectrumNetworkProvider(toCashScriptNetwork(config.network));
}
