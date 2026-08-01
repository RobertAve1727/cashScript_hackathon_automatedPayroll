import { beforeEach, describe, expect, it } from 'vitest';
import {
  FIXTURE_ANALYST,
  FIXTURE_ENTRY_LEVEL,
  commitmentForEmployee,
  commitmentToHex,
  encodeCommitment,
} from '../../../src/domain/index.js';
import {
  buildTx,
  employeePayeePkh,
  feePayerLockingBytecode,
  fundScenario,
  type Scenario,
} from '../../support/esahod.js';

/**
 * The proof the two final adversarial verifiers found missing: this suite
 * actually loads the compiled `payroll_treasury.json` / `employment_vault.json`
 * artifacts, builds a real transaction with `TransactionBuilder`, and lets
 * libauth's BCH VM judge every `require()` in the covenant. Nothing here
 * re-implements the arithmetic — `buildPaySalaryTransaction` calls the exact
 * same `computeDeductions` the covenant is meant to agree with, so a
 * one-centavo drift between the two shows up as `send()` throwing, not as a
 * passing assertion on a hand-copied number.
 */
describe('paySalary — real VM proof against the golden numbers', () => {
  describe('Fixture A — Maria Santos, taxed (8-output layout)', () => {
    let scenario: Scenario;

    beforeEach(() => {
      scenario = fundScenario(FIXTURE_ANALYST);
    });

    it('places every output exactly where the covenant requires it', () => {
      const outputs = buildTx(scenario).outputs;

      // 0 emp,1 sss,2 phic,3 hdmf,4 bir,5 nft,6 treasury change,7 BCH change to the fee payer
      // (the fee UTXO leaves real leftover value above dust, so the builder adds a real output).
      expect(outputs).toHaveLength(8);
      expect(outputs[0]?.token?.amount).toBe(1_606_590n); // net
      expect(outputs[1]?.token?.amount).toBe(264_000n); // SSS total
      expect(outputs[2]?.token?.amount).toBe(87_500n); // PhilHealth total
      expect(outputs[3]?.token?.amount).toBe(20_000n); // Pag-IBIG total
      expect(outputs[4]?.token?.amount).toBe(102_160n); // BIR
      expect(outputs[6]?.token?.amount).toBe(500_000_000n - 2_080_250n); // treasury change
    });

    it('is accepted by the BCH VM', async () => {
      await expect(buildTx(scenario).send()).resolves.toBeDefined();
    });

    it('advances the employment record to period 1 with every other field verbatim', async () => {
      await buildTx(scenario).send();

      const [advanced] = await scenario.provider.getUtxos(scenario.deployment.vault.address);

      expect(advanced?.token?.nft?.commitment).toBe(
        commitmentToHex(
          encodeCommitment(
            commitmentForEmployee(FIXTURE_ANALYST, { payeePkh: employeePayeePkh, nextPeriod: 1, endPeriod: 23 }),
          ),
        ),
      );
    });

    it('runs five consecutive periods back to back — the demo choreography', async () => {
      let currentScenario = scenario;

      for (let period = 0; period < 5; period += 1) {
        await buildTx(currentScenario).send();

        const [treasuryUtxo] = await currentScenario.provider.getUtxos(currentScenario.deployment.treasury.address);
        const [nftUtxo] = await currentScenario.provider.getUtxos(currentScenario.deployment.vault.address);
        const feeUtxos = await currentScenario.provider.getUtxosForLockingBytecode(feePayerLockingBytecode);
        // Fee change returns to the same fee payer, so the largest UTXO funds the next period.
        const feeUtxo = feeUtxos.reduce((a, b) => (a.satoshis > b.satoshis ? a : b));

        currentScenario = { ...currentScenario, treasuryUtxo: treasuryUtxo!, nftUtxo: nftUtxo!, feeUtxo };
      }

      const [finalTreasury] = await currentScenario.provider.getUtxos(currentScenario.deployment.treasury.address);
      expect(finalTreasury?.token?.amount).toBe(500_000_000n - 5n * 2_080_250n);
    }, 40_000);
  });

  describe('Fixture B — Jun Dela Cruz, zero tax (7-output layout, BIR omitted)', () => {
    let scenario: Scenario;

    beforeEach(() => {
      scenario = fundScenario(FIXTURE_ENTRY_LEVEL);
    });

    it('omits the BIR output and shifts NFT/change up by one', () => {
      const outputs = buildTx(scenario).outputs;

      // 0 emp,1 sss,2 phic,3 hdmf,4 nft,5 treasury change,6 BCH change — no BIR output at all.
      expect(outputs).toHaveLength(7);
      expect(outputs[0]?.token?.amount).toBe(730_000n);
      expect(outputs[1]?.token?.amount).toBe(121_500n);
      expect(outputs[2]?.token?.amount).toBe(40_000n);
      expect(outputs[3]?.token?.amount).toBe(20_000n);
      expect(outputs[4]?.token?.nft).toBeDefined(); // the NFT, not a BIR payment
      expect(outputs[5]?.token?.amount).toBe(500_000_000n - 911_500n);
    });

    it('is accepted by the BCH VM', async () => {
      await expect(buildTx(scenario).send()).resolves.toBeDefined();
    });
  });
});
