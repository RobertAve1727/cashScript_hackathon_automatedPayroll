#!/usr/bin/env node
/**
 * Process entry point.
 *
 * Reads configuration, composes the object graph, dispatches, sets an exit
 * code. Everything else — every rule, every calculation, every payment — lives
 * behind `composePayrollCli`, which is why this file has stayed this short.
 */
import { ConfigurationError, loadPayrollConfiguration } from '../infrastructure/index.js';
import { ExitCode } from '../presentation/index.js';
import { composePayrollCli } from './container.js';

async function main(): Promise<number> {
  let configuration;

  try {
    configuration = loadPayrollConfiguration();
  } catch (error) {
    if (error instanceof ConfigurationError) {
      process.stderr.write(`configuration error — ${error.message}\n`);
      return ExitCode.Usage;
    }
    throw error;
  }

  return composePayrollCli(configuration).run(process.argv.slice(2));
}

process.exitCode = await main();
