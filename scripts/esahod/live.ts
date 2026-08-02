#!/usr/bin/env node
/**
 * One command for a live demo: `npm run esahod:live`
 *
 * Starts the keeper relay and the app's dev server together, interleaves their
 * output with a prefix so it is obvious which one is talking, and shuts both
 * down on Ctrl-C.
 *
 * ══ WHY THIS EXISTS ═════════════════════════════════════════════════════
 *
 * The write path needs two processes — the browser cannot hold a signing key,
 * so the relay does — and it needed a handful of exported secrets besides.
 * Remembering both, in the right order, with the right variables, is the kind
 * of setup that works when you wrote it that morning and fails in front of an
 * audience. `lib/config.ts` now reads `scripts/esahod/.env` on its own, and
 * this starts the pair.
 *
 * Checks before starting, because each of these fails much less usefully later:
 *   - the keys file exists
 *   - the deployment exists
 *   - the app knows where the relay is
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ENV_FILE, readDeployment } from './lib/config.js';

const REPO = resolve(import.meta.dirname, '..', '..');
const APP_ENV = resolve(REPO, 'app', '.env.local');
const RELAY_PORT = process.env['ESAHOD_RELAY_PORT'] ?? '8787';

function fail(message: string, fix: string): never {
  console.error(`\n  ✗ ${message}\n    ${fix}\n`);
  process.exit(1);
}

if (!existsSync(ENV_FILE)) {
  fail(
    'scripts/esahod/.env does not exist, so the relay has no keys.',
    'Copy scripts/esahod/.env.example to scripts/esahod/.env and fill it in (npm run esahod:keys generates a fresh set).',
  );
}

const deployment = await readDeployment();
if (deployment.treasuryAddress === undefined) {
  fail(
    'scripts/esahod/deployment.json has no treasury — nothing is deployed.',
    'Run: npx tsx scripts/esahod/01-deploy.ts',
  );
}

if (!existsSync(APP_ENV) || !readFileSync(APP_ENV, 'utf8').includes('VITE_ESAHOD_RELAY_URL=http')) {
  fail(
    'app/.env.local does not point at the relay, so the app will read the chain but not write to it.',
    `Add: VITE_ESAHOD_RELAY_URL=http://localhost:${RELAY_PORT}`,
  );
}

const children: ChildProcess[] = [];

/**
 * Colour is worth it here: two servers writing to one terminal is otherwise
 * unreadable, and the whole point of this script is that the operator can see
 * at a glance which half is broken.
 */
function start(name: string, colour: string, command: string, args: string[], cwd: string): void {
  const child = spawn(command, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = `${colour}[${name}][0m`;

  const relay = (stream: NodeJS.ReadableStream): void => {
    let buffer = '';
    stream.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) if (line.trim() !== '') console.log(`${tag} ${line}`);
    });
  };

  relay(child.stdout!);
  relay(child.stderr!);

  child.on('exit', (code) => {
    console.log(`${tag} exited (${code})`);
    // One half dying makes the other useless and the demo confusing, so take
    // both down rather than leaving a UI that silently cannot write.
    shutdown();
  });

  children.push(child);
}

let shuttingDown = false;
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(0), 250);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log(`
  eSahod — live on chipnet

  treasury : ${deployment.treasuryAddress}
  relay    : http://localhost:${RELAY_PORT}
  app      : http://localhost:5173

  Sign in as ben.aquino@esahod.ph / esahod2026 and press Run payroll.
  Ctrl-C stops both.
`);

start('relay', '[35m', 'npx', ['tsx', resolve(import.meta.dirname, 'keeper-relay.ts')], REPO);
start('app', '[36m', 'npm', ['run', 'dev'], resolve(REPO, 'app'));
