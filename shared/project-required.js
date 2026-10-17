/**
 * project-required.js — the "every ticket has a project" creation rule, shared by the CLI and the
 * dashboard create modal. T-prefixed (project-less) tickets are for genuinely personal tasks only,
 * so creating one takes an explicit opt-out.
 */

/** Ids of the projects a ticket can be filed under, for error messages. */
export function projectChoices(metaProjects = []) {
  return (metaProjects || []).map(p => p.id).filter(Boolean);
}

/**
 * Decide which project a new ticket gets.
 * @param {{ project?: string, noProject?: boolean, parentProject?: string|null, metaProjects?: object[] }} input
 * @returns {{ project: string|null, error?: string }}
 */
export function resolveCreateProject({ project, noProject, parentProject, metaProjects = [] } = {}) {
  const explicit = (project || '').trim();
  if (explicit && noProject) return { project: null, error: 'use a project or "no project", not both' };
  if (explicit) return { project: explicit };
  if (noProject) return { project: null };
  if (parentProject) return { project: parentProject };
  const choices = projectChoices(metaProjects);
  const list = choices.length ? ` Valid projects: ${choices.join(', ')}.` : '';
  return {
    project: null,
    error: `a ticket needs a project (T-prefixed tickets are only for personal tasks with none). Pass --project <slug>, or --no-project for a personal task.${list}`,
  };
}
