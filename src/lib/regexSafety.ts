/**
 * Spots regular expressions prone to catastrophic backtracking, e.g. (a+)+$ or (\w*)*x: a group
 * that contains a quantifier and is itself repeated. Such patterns can take minutes on a short line,
 * and JavaScript can't interrupt a running RegExp, so they are rejected before they run.
 * This is a cheap heuristic, not a proof; the search worker's timeout catches the rest.
 */
export function findRegexRisk(source: string): string | null {
  // for every open group: did it contain a quantifier?
  const stack: boolean[] = [];
  let lastClosedHadQuantifier = false;
  let inClass = false;

  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '\\') {
      i++; // skip the escaped character
      lastClosedHadQuantifier = false;
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
      continue;
    }
    if (c === '[') {
      inClass = true;
      lastClosedHadQuantifier = false;
      continue;
    }
    if (c === '(') {
      stack.push(false);
      lastClosedHadQuantifier = false;
      continue;
    }
    if (c === ')') {
      lastClosedHadQuantifier = stack.pop() ?? false;
      // a group with a quantifier inside makes any enclosing group risky too
      if (lastClosedHadQuantifier && stack.length > 0) stack[stack.length - 1] = true;
      continue;
    }
    const isQuantifier = c === '+' || c === '*' || (c === '{' && /^\{\d+,\d*\}/.test(source.slice(i)));
    if (isQuantifier) {
      if (lastClosedHadQuantifier) {
        return 'Nested quantifiers like (a+)+ can freeze the page on some lines. Simplify the pattern.';
      }
      if (stack.length > 0) stack[stack.length - 1] = true;
    }
    if (c !== '?') lastClosedHadQuantifier = false;
  }
  return null;
}
