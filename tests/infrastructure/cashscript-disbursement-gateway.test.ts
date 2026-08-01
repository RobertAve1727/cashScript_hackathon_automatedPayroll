import { MockNetworkProvider, randomUtxo } from 'cashscript';
import { beforeEach, describe, expect, it } from 'vitest';
import { DisbursementFailedError } from '../../src/application/index.js';
import { BchNetwork, CashAddress, Satoshis } from '../../src/domain/index.js';
import {
  CashScriptDisbursementGateway,
  ChainMode,
  PersistenceMode,
  createPayrollTreasuryContract,
  loadSimpleBchTreasuryArtifact,
  resolveTreasuryKeys,
  type PayrollConfiguration,
  type PayrollTreasuryContract,
} from '../../src/infrastructure/index.js';
import { ALICE_TESTNET, BOB_TESTNET } from '../support/addresses.js';

const CONFIG: PayrollConfiguration = {
  network: BchNetwork.Testnet,
  chain: ChainMode.Mock,
  persistence: PersistenceMode.Memory,
  dataDirectory: '.payroll-data',
  operatorWif: null,
  treasurerPublicKeyHash: null,
  payoutIntervalBlocks: 1,
  feeRateSatsPerByte: 1,
};

/**
 * These exercise the real adapter against `MockNetworkProvider`: the
 * transaction is genuinely built, signed and evaluated by the Bitcoin Cash VM
 * before "broadcast". A contract whose `require` statements reject, or a
 * missing sequence number that fails OP_CHECKSEQUENCEVERIFY, fails here — which
 * is the whole reason to test the adapter rather than stub it.
 */
describe('CashScriptDisbursementGateway', () => {
  let provider: MockNetworkProvider;
  let contract: PayrollTreasuryContract;
  let gateway: CashScriptDisbursementGateway;

  const fund = (satoshis: bigint): void => {
    provider.addUtxo(contract.address, randomUtxo({ satoshis }));
  };

  beforeEach(() => {
    provider = new MockNetworkProvider();
    const keys = resolveTreasuryKeys(CONFIG);
    contract = createPayrollTreasuryContract(CONFIG, provider, keys, loadSimpleBchTreasuryArtifact());
    gateway = new CashScriptDisbursementGateway({
      contract,
      operator: keys.operator,
      network: CONFIG.network,
      payoutIntervalBlocks: CONFIG.payoutIntervalBlocks,
      feeRateSatsPerByte: CONFIG.feeRateSatsPerByte,
    });
  });

  describe('summarise', () => {
    it('reports an empty treasury', async () => {
      const summary = await gateway.summarise();

      expect(summary.availableFunds.isZero()).toBe(true);
      expect(summary.network).toBe(BchNetwork.Testnet);
      expect(summary.address.value).toBe(contract.address);
    });

    it('sums every treasury coin', async () => {
      fund(100_000n);
      fund(250_000n);

      expect((await gateway.summarise()).availableFunds.value).toBe(350_000n);
    });
  });

  describe('disburse', () => {
    it('pays every line in a single transaction that the VM accepts', async () => {
      fund(10_000_000n);

      const receipt = await gateway.disburse({
        reference: 'run-1',
        lines: [
          { recipient: CashAddress.parse(ALICE_TESTNET), amount: Satoshis.from(1_000_000n) },
          { recipient: CashAddress.parse(BOB_TESTNET), amount: Satoshis.from(500_000n) },
        ],
      });

      expect(receipt.transactionId).toMatch(/^[0-9a-f]{64}$/);
      expect(receipt.feePaid.value).toBeGreaterThan(0n);
    });

    it('moves the paid amounts to the employees and the change back to the treasury', async () => {
      fund(10_000_000n);
      const net = 1_000_000n;

      const receipt = await gateway.disburse({
        reference: 'run-1',
        lines: [{ recipient: CashAddress.parse(ALICE_TESTNET), amount: Satoshis.from(net) }],
      });

      const alice = await provider.getUtxos(ALICE_TESTNET);
      const treasury = await gateway.summarise();

      expect(alice.map((utxo) => utxo.satoshis)).toEqual([net]);
      expect(treasury.availableFunds.value).toBe(10_000_000n - net - receipt.feePaid.value);
    });

    it('combines several coins when one does not cover the run', async () => {
      fund(600_000n);
      fund(600_000n);

      const receipt = await gateway.disburse({
        reference: 'run-1',
        lines: [{ recipient: CashAddress.parse(ALICE_TESTNET), amount: Satoshis.from(1_000_000n) }],
      });

      expect(receipt.transactionId).toMatch(/^[0-9a-f]{64}$/);
    });

    it('fails cleanly when the treasury cannot cover the run', async () => {
      fund(1_000n);

      await expect(
        gateway.disburse({
          reference: 'run-1',
          lines: [{ recipient: CashAddress.parse(ALICE_TESTNET), amount: Satoshis.from(5_000_000n) }],
        }),
      ).rejects.toBeInstanceOf(DisbursementFailedError);
    });

    it('rejects an empty batch', async () => {
      await expect(gateway.disburse({ reference: 'run-1', lines: [] })).rejects.toThrow(/nothing to pay/);
    });
  });

  describe('the contract itself', () => {
    it('derives a deterministic p2sh32 treasury address', () => {
      const again = createPayrollTreasuryContract(
        CONFIG,
        provider,
        resolveTreasuryKeys(CONFIG),
        loadSimpleBchTreasuryArtifact(),
      );

      expect(again.address).toBe(contract.address);
      expect(contract.address.startsWith('bchtest:')).toBe(true);
    });

    it('changes address when the payout interval changes, because it is a constructor argument', () => {
      const slower = { ...CONFIG, payoutIntervalBlocks: 4_032 };
      const other = createPayrollTreasuryContract(
        slower,
        provider,
        resolveTreasuryKeys(slower),
        loadSimpleBchTreasuryArtifact(),
      );

      expect(other.address).not.toBe(contract.address);
    });

    it('exposes the two spending paths from the compiled artifact', () => {
      expect(loadSimpleBchTreasuryArtifact().abi.map((entry) => entry.name)).toEqual(['disburse', 'reclaim']);
    });
  });
});
