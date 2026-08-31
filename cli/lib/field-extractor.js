/**
 * cli/lib/field-extractor.js
 *
 * Extracts and writes structured fields from memory markdown files.
 * Supports three person file formats and project top-level bullet format.
 *
 * Exports:
 *   extractFields(content): { fields, name }
 *   writeField(content, canonicalKey, value): string | null
 *   getSlugName(slug): string
 */

import { parseFrontmatter, getDisplayName } from '../../dashboard/js/memory-parser.js';

// ---------------------------------------------------------------------------
// Alias map: normalised label -> canonical key
// ---------------------------------------------------------------------------
const LABEL_ALIASES = {
  // slack_id
  'slack id': 'slack_id',
  'slack': 'slack_id',
  // email
  'email': 'email',
  // github
  'github': 'github',
  'github username': 'github',
  // atlassian_id
  'atlassian id': 'atlassian_id',
  'atlassian': 'atlassian_id',
  // canvas_url
  '1:1 canvas': 'canvas_url',
  'canvas': 'canvas_url',
  'canvas url': 'canvas_url',
  '1:1 canvas url': 'canvas_url',
  // role
  'role': 'role',
  // status
  'status': 'status',
  // epic
  'epic': 'epic',
  // task_id
  'task id': 'task_id',
  'task': 'task_id',
  // slack_channel
  'slack channel': 'slack_channel',
  // slack_title
  'slack title': 'slack_title',
  // slack_username
  'slack username': 'slack_username',
  'username': 'slack_username',
  // description
  'description': 'description',
};

/**
 * Normalise a raw label string to a canonical key.
 * Returns the raw label (lowercased, trimmed) if no alias found.
 */
function normalizeLabel(raw) {
  const key = raw.toLowerCase().trim();
  return LABEL_ALIASES[key] || key.replace(/\s+/g, '_');
}

/**
 * Reduce a markdown link [text](url) to text only.
 * If the value is not a markdown link, return it unchanged.
 */
function stripMdLink(value) {
  const m = value.match(/^\[([^\]]*)\]\([^)]*\)$/);
  return m ? m[1] : value;
}

// ---------------------------------------------------------------------------
// extractFields(content): { fields, name }
// ---------------------------------------------------------------------------

/**
 * Extract structured fields from memory markdown content.
 *
 * Handles three shapes:
 *   (a) Contact block: "**Contact:**" header + "- Label: value" bullets
 *   (b) Flat bold bullets: "- **Label:** value"
 *   (c) Top-level bold kv: "**Label:** value"
 *
 * Also parses frontmatter for name/description/type.
 *
 * @param {string} content
 * @returns {{ fields: Record<string,string>, name: string }}
 */
export function extractFields(content) {
  const { frontmatter, body } = parseFrontmatter(content);
  const fields = {};

  // Copy frontmatter scalars under canonical keys
  for (const [k, v] of Object.entries(frontmatter)) {
    const canon = normalizeLabel(k);
    fields[canon] = String(v);
  }

  const lines = body.split('\n');

  // Detect file type: contact-block vs flat-bullet vs project top-level
  const hasContactHeader = lines.some(l => /^\*\*Contact:\*\*/.test(l));

  if (hasContactHeader) {
    // (a) Contact-block format
    // Also collect top-level "**Label:** value" lines (for Role, Gender, etc.)
    let inContact = false;
    for (const line of lines) {
      // Top-level **Label:** value (not inside contact block)
      if (!inContact) {
        const topKv = line.match(/^\*\*(.+?):\*\*\s*(.+)$/);
        if (topKv) {
          const labelRaw = topKv[1].trim();
          const label = labelRaw.toLowerCase();
          if (label !== 'contact') {
            const canon = normalizeLabel(labelRaw);
            const val = stripMdLink(topKv[2].trim());
            if (val) fields[canon] = val;
          }
        }
      }

      if (/^\*\*Contact:\*\*/.test(line)) {
        inContact = true;
        continue;
      }

      if (inContact) {
        // blank line or next **...:** header ends contact block
        if (line.trim() === '' || /^\*\*/.test(line)) {
          inContact = false;
          // If it's a new **Label:** value line, handle it
          if (/^\*\*[^C]/.test(line) || /^\*\*[A-Z]/.test(line)) {
            // Re-check: is it a kv line outside contact?
            const topKv = line.match(/^\*\*(.+?):\*\*\s*(.+)$/);
            if (topKv) {
              const canon = normalizeLabel(topKv[1].trim());
              const val = stripMdLink(topKv[2].trim());
              if (val) fields[canon] = val;
            }
          }
          continue;
        }
        // Bullet inside contact block: "- Label: value"
        const bullet = line.match(/^-\s+(.+?):\s+(.+)$/);
        if (bullet) {
          const canon = normalizeLabel(bullet[1]);
          fields[canon] = stripMdLink(bullet[2].trim());
        }
      }
    }
  } else {
    // (b) Flat bold bullets: "- **Label:** value"
    // (c) Top-level "**Label:** value" (project style)
    for (const line of lines) {
      // flat bold bullet
      const flatBullet = line.match(/^-\s+\*\*(.+?):\*\*\s*(.+)$/);
      if (flatBullet) {
        const canon = normalizeLabel(flatBullet[1]);
        fields[canon] = stripMdLink(flatBullet[2].trim());
        continue;
      }
      // top-level kv
      const topKv = line.match(/^\*\*(.+?):\*\*\s*(.+)$/);
      if (topKv) {
        const canon = normalizeLabel(topKv[1]);
        fields[canon] = stripMdLink(topKv[2].trim());
      }
    }
  }

  // Derive canvas_id from canvas_url
  if (fields.canvas_url && !fields.canvas_id) {
    const parts = fields.canvas_url.replace(/\/$/, '').split('/');
    if (parts.length > 0) {
      fields.canvas_id = parts[parts.length - 1];
    }
  }

  // Determine name: frontmatter.name > frontmatter first H1 in body > slug fallback
  let name = frontmatter.name || '';
  if (!name) {
    for (const line of lines) {
      const h1 = line.match(/^#\s+(.+)$/);
      if (h1) { name = h1[1].trim(); break; }
    }
  }

  return { fields, name };
}

// ---------------------------------------------------------------------------
// writeField(content, canonicalKey, value): string | null
// ---------------------------------------------------------------------------

/**
 * Return updated content with canonicalKey set to value, or null if unsupported.
 *
 * Supports:
 *   - Contact-block format: updates "- Label: value" inside **Contact:** block
 *   - Flat bold bullet: updates "- **Label:** value"
 *   - Project top-level bullet: updates "**Label:** value"
 *
 * If the field is found and updated, returns new content.
 * If field not found and format supports appending, appends it.
 * Returns null if the format is unrecognised or we can't safely edit.
 */
export function writeField(content, canonicalKey, value) {
  const { body } = parseFrontmatter(content);
  const lines = body.split('\n');
  const hasContactHeader = lines.some(l => /^\*\*Contact:\*\*/.test(l));

  // Reverse-lookup: canonical key -> a preferred label string to write
  const CANON_TO_LABEL = {
    slack_id: 'Slack ID',
    email: 'Email',
    github: 'GitHub',
    atlassian_id: 'Atlassian ID',
    canvas_url: '1:1 Canvas',
    role: 'Role',
    status: 'Status',
    epic: 'Epic',
    task_id: 'Task ID',
    slack_channel: 'Slack channel',
    slack_title: 'Slack title',
    slack_username: 'Slack username',
    description: 'Description',
  };
  const labelStr = CANON_TO_LABEL[canonicalKey] || canonicalKey;

  if (hasContactHeader) {
    // Contact-block format
    let inContact = false;
    let contactEndIdx = -1;
    let foundIdx = -1;

    const contentLines = content.split('\n');
    for (let i = 0; i < contentLines.length; i++) {
      const line = contentLines[i];
      if (/^\*\*Contact:\*\*/.test(line)) {
        inContact = true;
        continue;
      }
      if (inContact) {
        if (line.trim() === '' || (line.startsWith('**') && !/^-\s/.test(line))) {
          inContact = false;
          if (contactEndIdx === -1) contactEndIdx = i;
          continue;
        }
        const bullet = line.match(/^-\s+(.+?):\s+(.*)$/);
        if (bullet && normalizeLabel(bullet[1]) === canonicalKey) {
          foundIdx = i;
        }
      }
    }

    if (foundIdx !== -1) {
      // Update existing line
      const updated = contentLines.slice();
      updated[foundIdx] = `- ${labelStr}: ${value}`;
      return updated.join('\n');
    }

    // Append inside contact block (before its end)
    if (contactEndIdx !== -1) {
      const updated = contentLines.slice();
      updated.splice(contactEndIdx, 0, `- ${labelStr}: ${value}`);
      return updated.join('\n');
    }

    // Contact block runs to end of file
    return content.trimEnd() + `\n- ${labelStr}: ${value}\n`;
  }

  // Flat bold bullet: "- **Label:** value"
  const hasFlatBullets = lines.some(l => /^-\s+\*\*[^*]+:\*\*/.test(l));
  if (hasFlatBullets) {
    const contentLines = content.split('\n');
    for (let i = 0; i < contentLines.length; i++) {
      const m = contentLines[i].match(/^-\s+\*\*(.+?):\*\*\s*(.*)$/);
      if (m && normalizeLabel(m[1]) === canonicalKey) {
        contentLines[i] = `- **${labelStr}:** ${value}`;
        return contentLines.join('\n');
      }
    }
    // Append
    return content.trimEnd() + `\n- **${labelStr}:** ${value}\n`;
  }

  // Project top-level "**Label:** value"
  const hasTopKv = lines.some(l => /^\*\*[^*]+:\*\*/.test(l));
  if (hasTopKv) {
    const contentLines = content.split('\n');
    for (let i = 0; i < contentLines.length; i++) {
      const m = contentLines[i].match(/^\*\*(.+?):\*\*\s*(.*)$/);
      if (m && normalizeLabel(m[1]) === canonicalKey) {
        contentLines[i] = `**${labelStr}:** ${value}`;
        return contentLines.join('\n');
      }
    }
    // Append before first ## section or at end
    const sectionIdx = contentLines.findIndex(l => /^##\s/.test(l));
    if (sectionIdx > 0) {
      const updated = contentLines.slice();
      updated.splice(sectionIdx, 0, `**${labelStr}:** ${value}`, '');
      return updated.join('\n');
    }
    return content.trimEnd() + `\n**${labelStr}:** ${value}\n`;
  }

  // Unrecognised format
  return null;
}

// ---------------------------------------------------------------------------
// getSlugName(slug): Title Case string
// ---------------------------------------------------------------------------

/**
 * Convert a slug (kebab/underscore) to Title Case display name.
 * Delegates to memory-parser's getDisplayName for consistency.
 *
 * @param {string} slug
 * @returns {string}
 */
export function getSlugName(slug) {
  return getDisplayName(slug);
}
