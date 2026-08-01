import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(import.meta.dirname, '..', '..', 'src');

type Layer = 'domain' | 'application' | 'infrastructure' | 'presentation' | 'main';
type Target = Layer | 'node' | 'external';

interface LayerPolicy {
  /** Layers this one may import from. */
  readonly mayImport: readonly Layer[];
  /** May it import third-party packages? */
  readonly mayImportExternal: boolean;
  /** May it import Node built-ins? */
  readonly mayImportNode: boolean;
}

/**
 * The dependency rule, written down so the build enforces it.
 *
 * Documentation describing an architecture decays the moment someone adds a
 * convenient import. This test reads every source file, resolves every import,
 * and fails if an arrow points the wrong way — so the diagram in the README
 * cannot quietly stop being true.
 *
 * The strictest rows are the interesting ones. `domain` may import nothing at
 * all — not a package, not even `node:crypto` — which is what makes payroll
 * rules testable with no setup and portable to any runtime. `application` may
 * use the domain and nothing else, so a use case physically cannot reach for a
 * database driver or the CashScript library.
 */
const POLICY: Readonly<Record<Layer, LayerPolicy>> = {
  domain: { mayImport: ['domain'], mayImportExternal: false, mayImportNode: false },
  application: { mayImport: ['domain', 'application'], mayImportExternal: false, mayImportNode: false },
  infrastructure: {
    mayImport: ['domain', 'application', 'infrastructure'],
    mayImportExternal: true,
    mayImportNode: true,
  },
  presentation: {
    mayImport: ['domain', 'application', 'presentation'],
    mayImportExternal: true,
    mayImportNode: true,
  },
  main: {
    mayImport: ['domain', 'application', 'infrastructure', 'presentation', 'main'],
    mayImportExternal: true,
    mayImportNode: true,
  },
};

/**
 * Anchored at the start of a statement and forbidden from crossing a quote, so
 * the word "from" inside a message string is never mistaken for an import.
 */
const IMPORT_PATTERNS = [
  /^\s*import\s[^;'"]*?from\s*['"]([^'"]+)['"]/gm, // import x from '…' / import type { x } from '…'
  /^\s*import\s*['"]([^'"]+)['"]/gm, // import '…'
  /^\s*export\s[^;'"]*?from\s*['"]([^'"]+)['"]/gm, // export … from '…' (barrels)
];

interface Dependency {
  readonly file: string;
  readonly specifier: string;
  readonly from: Layer;
  readonly to: Target;
}

function sourceFiles(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((entry) => entry.endsWith('.ts'))
    .map((entry) => join(SRC, entry));
}

function layerOf(absolutePath: string): Layer {
  const segment = relative(SRC, absolutePath).split(sep)[0];
  if (segment !== undefined && segment in POLICY) return segment as Layer;

  throw new Error(`${absolutePath} is not inside a known layer`);
}

function classify(specifier: string, importingFile: string): Target {
  if (specifier.startsWith('node:')) return 'node';
  if (!specifier.startsWith('.')) return 'external';

  return layerOf(resolve(dirname(importingFile), specifier));
}

function dependencies(): Dependency[] {
  return sourceFiles().flatMap((file) => {
    const contents = readFileSync(file, 'utf8');
    const from = layerOf(file);
    const specifiers = IMPORT_PATTERNS.flatMap((pattern) =>
      [...contents.matchAll(pattern)].map((match) => match[1] ?? ''),
    );

    return specifiers.map((specifier) => ({
      file: relative(SRC, file),
      specifier,
      from,
      to: classify(specifier, file),
    }));
  });
}

describe('the dependency rule', () => {
  const all = dependencies();

  it('finds source files to inspect', () => {
    expect(sourceFiles().length).toBeGreaterThan(30);
    expect(all.length).toBeGreaterThan(50);
  });

  it.each(Object.keys(POLICY) as Layer[])('%s only imports the layers it is allowed to', (layer) => {
    const policy = POLICY[layer];

    const violations = all
      .filter((dependency) => dependency.from === layer)
      .filter((dependency) => {
        if (dependency.to === 'external') return !policy.mayImportExternal;
        if (dependency.to === 'node') return !policy.mayImportNode;

        return !policy.mayImport.includes(dependency.to);
      })
      .map((dependency) => `${dependency.file} -> ${dependency.specifier} (${dependency.to})`);

    expect(violations).toEqual([]);
  });

  it('keeps the domain free of every dependency, including Node built-ins', () => {
    const impure = all
      .filter((dependency) => dependency.from === 'domain')
      .filter((dependency) => dependency.to === 'external' || dependency.to === 'node');

    expect(impure).toEqual([]);
  });

  it('confines Bitcoin Cash libraries to the infrastructure layer', () => {
    const chainPackages = ['cashscript', 'cashc', '@bitauth/libauth', '@cashscript/utils'];

    const leaks = all
      .filter((dependency) => chainPackages.some((name) => dependency.specifier === name || dependency.specifier.startsWith(`${name}/`)))
      .filter((dependency) => dependency.from !== 'infrastructure')
      .map((dependency) => `${dependency.file} -> ${dependency.specifier}`);

    expect(leaks).toEqual([]);
  });

  it('lets only the composition root know about infrastructure', () => {
    const reachers = all
      .filter((dependency) => dependency.to === 'infrastructure' && dependency.from !== 'infrastructure')
      .map((dependency) => dependency.from);

    expect([...new Set(reachers)]).toEqual(['main']);
  });

  it('keeps every layer barrel free of upward imports', () => {
    const barrels = all.filter((dependency) => dependency.file.endsWith(`${sep}index.ts`));

    expect(barrels.length).toBeGreaterThan(0);
    expect(barrels.filter((dependency) => dependency.to === 'main')).toEqual([]);
  });
});
