// SPDX-License-Identifier: AGPL-3.0-or-later
// Minimal SPDX licence-expression evaluator. Precedence: WITH > AND > OR.

/** Splits an expression into identifiers (`X WITH Y` kept as one), operators and parens. */
function tokenize(expression) {
  const raw = expression
    .replace(/([()])/g, ' $1 ')
    .trim()
    .split(/\s+/);
  const tokens = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i + 1] === 'WITH' && raw[i + 2] !== undefined) {
      tokens.push(`${raw[i]} WITH ${raw[i + 2]}`);
      i += 2;
    } else {
      tokens.push(raw[i]);
    }
  }
  return tokens;
}

/**
 * True when the expression can be satisfied using only licences in `allowed`.
 * Malformed expressions are rejected.
 */
export function isAllowed(expression, allowed) {
  if (typeof expression !== 'string' || expression.trim() === '') return false;
  const tokens = tokenize(expression);
  let pos = 0;

  const fail = () => {
    throw new SyntaxError(`invalid SPDX expression: ${expression}`);
  };
  const orExpr = () => {
    let value = andExpr();
    while (tokens[pos] === 'OR') {
      pos++;
      const rhs = andExpr();
      value = value || rhs;
    }
    return value;
  };
  const andExpr = () => {
    let value = atom();
    while (tokens[pos] === 'AND') {
      pos++;
      const rhs = atom();
      value = value && rhs;
    }
    return value;
  };
  const atom = () => {
    const token = tokens[pos++];
    if (token === undefined || token === ')' || token === 'AND' || token === 'OR') fail();
    if (token === '(') {
      const value = orExpr();
      if (tokens[pos++] !== ')') fail();
      return value;
    }
    return allowed.has(token);
  };

  try {
    const value = orExpr();
    return pos === tokens.length && value;
  } catch {
    return false;
  }
}
