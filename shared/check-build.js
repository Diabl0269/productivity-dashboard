/**
 * shared/check-build.js — PRO100: the build a check's project opens in, and whether it has the change.
 * Pure (no fs, no DOM). The app comes from config.json `reviewProjectApps` (cli/lib/evidence.js
 * pickReviewApp), the freshness from the card's PR links (shared/build-freshness-rollup.js).
 */

/**
 * What to show next to a check's Open project button, or null when there is nothing to say.
 * `build` is { app, builtAt? } (the newest configured app) or null; `freshness` is the card's rolled-up
 * line { kind: 'current'|'stale'|'unknown' } or null. A check with no project shows nothing, and an
 * unknown freshness shows the build path alone (never a guess). A check about an unmerged branch
 * never claims "in your build": the build cannot have that change.
 * @returns {{ project: string, app: string, builtAt: string|null, state: 'current'|'stale'|null, text: string|null }|null}
 */
export function checkBuildInfo(check, build, freshness = null) {
  if (!check || typeof check.project !== 'string' || !check.project) return null;
  if (!build || typeof build.app !== 'string' || !build.app) return null;
  const known = !check.heldPr && freshness && (freshness.kind === 'current' || freshness.kind === 'stale');
  const state = known ? freshness.kind : null;
  return {
    project: check.project,
    app: build.app,
    builtAt: build.builtAt || null,
    state,
    text: state === 'current' ? 'in your build' : state === 'stale' ? 'needs a newer build' : null,
  };
}

/** The muted line a check without a project shows: "No project: <reason>", or null when it has a project or no reason. */
export function noProjectLine(check) {
  if (!check || check.project || typeof check.noProject !== 'string' || !check.noProject) return null;
  return `No project: ${check.noProject}`;
}
