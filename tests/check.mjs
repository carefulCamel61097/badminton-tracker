/* The assertion vocabulary the suites share.
 *
 * The runner reads stdout rather than exit codes alone, and keys on the two
 * lines `report()` prints, so every suite has to end with one.
 */

let failures = 0;
let total = 0;

export function check(label, condition, detail = '') {
  total++;
  if (!condition) failures++;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  return !!condition;
}

export function eq(label, actual, expected) {
  return check(label, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

export function near(label, actual, expected, tol = 0.01) {
  return check(label, Math.abs(actual - expected) <= tol, `got ${actual}, want ~${expected}`);
}

/** Prints the verdict the runner greps for and returns the exit code. */
export function report(extra = '') {
  if (extra) console.log(extra);
  console.log(failures ? `\nFAILURES: ${failures}` : `\nALL CHECKS PASSED (${total})`);
  return failures ? 1 : 0;
}
