import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A cycle between modules that import each other's *values* leaves one side holding a
 * half-initialised binding when the bundled handler boots, and `ez4 serve` answers the first
 * request that touches it with `RangeError: Maximum call stack size exceeded`. Type-only imports
 * are erased at build time, so they never form a runtime cycle and are ignored here.
 */
const ROOT = resolve(import.meta.dirname);

const IMPORT = /^\s*import\s+(?:type\s+)?[^'"]*from\s+['"]([^'"]+)['"]/;
const TYPE_ONLY = /^\s*import\s+type\s/;

function sourceFiles(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) {
      sourceFiles(path, found);
      continue;
    }

    if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      found.push(path);
    }
  }

  return found;
}

function resolveSpecifier(from: string, specifier: string, known: Set<string>): string | null {
  if (!specifier.startsWith('.')) {
    return null;
  }

  const target = resolve(dirname(from), specifier);

  for (const candidate of [`${target}.ts`, join(target, 'index.ts')]) {
    if (known.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

function valueGraph(): Map<string, string[]> {
  const files = sourceFiles(ROOT);
  const known = new Set(files);
  const graph = new Map<string, string[]>();

  for (const file of files) {
    const edges: string[] = [];

    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const match = IMPORT.exec(line);

      if (!match || TYPE_ONLY.test(line)) {
        continue;
      }

      const target = resolveSpecifier(file, match[1]!, known);

      if (target && !edges.includes(target)) {
        edges.push(target);
      }
    }

    graph.set(file, edges);
  }

  return graph;
}

function findCycles(graph: Map<string, string[]>): string[][] {
  const state = new Map<string, 'open' | 'done'>();
  const stack: string[] = [];
  const cycles: string[][] = [];

  const walk = (node: string) => {
    state.set(node, 'open');
    stack.push(node);

    for (const next of graph.get(node) ?? []) {
      if (state.get(next) === 'open') {
        cycles.push([...stack.slice(stack.indexOf(next)), next]);
      } else if (!state.has(next)) {
        walk(next);
      }
    }

    stack.pop();
    state.set(node, 'done');
  };

  for (const node of graph.keys()) {
    if (!state.has(node)) {
      walk(node);
    }
  }

  return cycles;
}

describe('module graph', () => {
  it('has no runtime import cycle', () => {
    const cycles = findCycles(valueGraph()).map((cycle) => cycle.map((file) => relative(ROOT, file)).join(' -> '));

    expect(cycles).toEqual([]);
  });
});
