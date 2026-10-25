// SPDX-License-Identifier: AGPL-3.0-or-later
// Pulls single function definitions out of reference source files, so inner
// helpers of UI modules (not exported) can run without a DOM.

import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import { readRef } from './reference.mjs';

const parsed = new Map();

function parse(relFile) {
  if (!parsed.has(relFile)) {
    const text = readRef(relFile);
    let ast;
    for (const sourceType of ['module', 'script']) {
      try {
        ast = acorn.parse(text, { ecmaVersion: 'latest', sourceType, locations: true });
        break;
      } catch (e) {
        if (sourceType === 'script') throw e;
      }
    }
    parsed.set(relFile, { text, ast });
  }
  return parsed.get(relFile);
}

/**
 * Finds `function name(...)` or `const name = (...) => ...` anywhere in the
 * file. `occurrence` picks one when the name is defined more than once.
 * Returns { name, file, source, start, end } with 1-based lines.
 */
export function extractFunction(relFile, name, { occurrence } = {}) {
  const { text, ast } = parse(relFile);
  const hits = [];
  walk.full(ast, (node) => {
    if (node.type === 'FunctionDeclaration' && node.id?.name === name) {
      hits.push({ node, source: text.slice(node.start, node.end) });
    } else if (
      node.type === 'VariableDeclarator' &&
      node.id.type === 'Identifier' &&
      node.id.name === name &&
      /FunctionExpression|ArrowFunctionExpression/.test(node.init?.type ?? '')
    ) {
      hits.push({ node, source: `const ${name} = ${text.slice(node.init.start, node.init.end)};` });
    }
  });
  if (hits.length === 0) throw new Error(`${relFile}: function ${name} not found`);
  if (hits.length > 1 && occurrence === undefined) {
    const lines = hits.map((h) => h.node.loc.start.line).join(', ');
    throw new Error(
      `${relFile}: ${name} defined ${hits.length} times (lines ${lines}); pass occurrence`,
    );
  }
  const hit = hits[occurrence ?? 0];
  return {
    name,
    file: relFile,
    source: hit.source,
    start: hit.node.loc.start.line,
    end: hit.node.loc.end.line,
  };
}

/** Finds a top-level `const name = <expr>` (non-function), e.g. a lookup table. */
export function extractConst(relFile, name) {
  const { text, ast } = parse(relFile);
  for (const stmt of ast.body) {
    const decl = stmt.type === 'ExportNamedDeclaration' ? stmt.declaration : stmt;
    if (decl?.type !== 'VariableDeclaration') continue;
    for (const d of decl.declarations) {
      if (d.id.type === 'Identifier' && d.id.name === name) {
        return {
          name,
          file: relFile,
          source: `const ${name} = ${text.slice(d.init.start, d.init.end)};`,
          start: d.loc.start.line,
          end: d.loc.end.line,
        };
      }
    }
  }
  throw new Error(`${relFile}: const ${name} not found`);
}

/**
 * Evaluates extracted definitions in one shared scope. `scope` supplies free
 * variables (stubs, Store, ...). Returns { fns: {name: fn}, refs: ['file:a-b name'] }.
 */
export function bindFunctions(defs, scope = {}) {
  const names = defs.map((d) => d.name);
  const body = `${defs.map((d) => d.source).join('\n')}\nreturn { ${names.join(', ')} };`;
  const fn = new Function(...Object.keys(scope), body);
  return { fns: fn(...Object.values(scope)), refs: defs.map(refOf) };
}

export const refOf = (d) => `${d.file}:${d.start}-${d.end} ${d.name}`;

/**
 * Wraps inline reference code (lines start..end, 1-based, inclusive) in a named
 * function so it can run on its own. `contains` must occur in the snippet, so a
 * shifted line range fails loudly instead of running the wrong code.
 * `prologue`/`epilogue` add the glue (parameters in, result out); the snippet
 * itself is never edited. With `breakable`, the snippet runs inside a
 * do/while(false) so its `break` statements work (its consts are then not
 * visible to the epilogue).
 */
export function extractSnippet(
  relFile,
  { start, end, name, params = [], prologue = '', epilogue = '', contains, breakable = false },
) {
  const lines = readRef(relFile)
    .split(/\r?\n/)
    .slice(start - 1, end);
  const text = lines.join('\n');
  for (const c of [contains].flat()) {
    if (!text.includes(c))
      throw new Error(
        `${relFile}:${start}-${end}: snippet ${name} does not contain ${JSON.stringify(c)}`,
      );
  }
  const body = breakable ? `do {\n${text}\n} while (false);` : text;
  const source = `function ${name}(${params.join(', ')}) {\n${prologue}\n${body}\n${epilogue}\n}`;
  return { name, file: relFile, source, start, end };
}
