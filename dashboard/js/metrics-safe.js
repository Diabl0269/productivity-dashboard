// metrics-safe.js — keeps one broken Metrics section from blanking the page.
// safe() runs a section renderer; when it throws, the error goes to console.error and the
// caller's fallback (a short message element) takes the section's place. No DOM here, so it is
// unit-tested directly (cli/test/metrics-safe.test.js).

/**
 * @param {string} name  section label shown in the message and the console
 * @param {() => any} fn the renderer
 * @param {(name: string, err: unknown) => any} [fallback] builds what to show instead
 * @returns {any} fn's result, or fallback's result (null without one) when fn throws
 */
export function safe(name, fn, fallback) {
  try {
    return fn();
  } catch (err) {
    console.error(`metrics: the "${name}" section failed to draw`, err);
    try {
      return fallback ? fallback(name, err) : null;
    } catch (err2) {
      console.error(`metrics: the fallback for "${name}" failed too`, err2);
      return null;
    }
  }
}
