/**
 * Field checks for home.config.json (pure, no fs, no DOM). Each check returns the clean value and
 * pushes a plain-words problem onto `errors` when the input is wrong. shared/home-config.js uses them
 * to build the normalised v1 config; problems never throw, so one bad key never blanks the page.
 */

/** Box ids go in the URL (?where=<id>): letters, digits, "-" and "_" only. */
export const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** A short printable form of a bad value for an error message. */
export function shown(v) {
  if (v === undefined) return 'nothing';
  let s;
  try { s = JSON.stringify(v); } catch { s = String(v); }
  if (s === undefined) s = String(v);
  return s.length > 40 ? `${s.slice(0, 37)}...` : s;
}

/** "group "kitchen" > area "oven"" style prefix, or "the file" at the top. */
export function at(where) {
  return where || 'the file';
}

export function problem(errors, where, key, what, value) {
  const got = arguments.length > 4 ? `, got ${shown(value)}` : '';
  errors.push(`${at(where)}: "${key}" ${what}${got}.`);
}

/** Optional string; '' when missing. */
export function str(obj, key, where, errors, fallback = '') {
  const v = obj[key];
  if (v === undefined || v === null) return fallback;
  if (typeof v === 'string') return v;
  problem(errors, where, key, 'should be text', v);
  return fallback;
}

/** Optional string or null. */
export function strOrNull(obj, key, where, errors) {
  const v = obj[key];
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'string') return v;
  problem(errors, where, key, 'should be text', v);
  return null;
}

/** Optional list of strings; non-strings are dropped with one problem. */
export function strList(obj, key, where, errors, { allowNull = false } = {}) {
  const v = obj[key];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) {
    problem(errors, where, key, 'should be a list of text', v);
    return [];
  }
  const ok = v.filter(x => typeof x === 'string' || (allowNull && x === null));
  if (ok.length !== v.length) {
    problem(errors, where, key, allowNull ? 'should hold only text or null' : 'should hold only text', v);
  }
  return ok;
}

/** Optional regular expression source (matched case-insensitively against ticket titles). */
export function regex(obj, key, where, errors) {
  const v = strOrNull(obj, key, where, errors);
  if (v === null) return null;
  try {
    new RegExp(v, 'i');
    return v;
  } catch (e) {
    problem(errors, where, key, `is not a valid pattern (${e.message.replace(/^Invalid regular expression: /, '')})`);
    return null;
  }
}

/** Optional [x, y, width, height] rectangle, width and height above zero. */
export function rect(obj, key, where, errors) {
  const v = obj[key];
  if (v === undefined || v === null) return null;
  const ok = Array.isArray(v) && v.length === 4 && v.every(n => typeof n === 'number' && Number.isFinite(n))
    && v[2] > 0 && v[3] > 0;
  if (!ok) {
    problem(errors, where, key, 'should be four numbers [x, y, width, height] with width and height above 0', v);
    return null;
  }
  return v.slice();
}

/** Required id: text that is safe in a URL. Returns null (and a problem) when unusable. */
export function id(obj, where, errors) {
  const v = obj.id;
  if (v === undefined || v === null || v === '') {
    errors.push(`${at(where)}: "id" is missing, so this entry is skipped.`);
    return null;
  }
  if (typeof v !== 'string' || !ID_RE.test(v)) {
    errors.push(`${at(where)}: "id" should be letters, digits, "-" or "_" (it goes in the page address), got ${shown(v)}; this entry is skipped.`);
    return null;
  }
  return v;
}

/** Report keys this level does not know ("$comment"-style keys are always allowed). */
export function unknownKeys(obj, known, where, errors) {
  for (const key of Object.keys(obj)) {
    if (key.startsWith('$') || known.includes(key)) continue;
    errors.push(`${at(where)}: unknown key "${key}", ignored (known keys: ${known.join(', ')}).`);
  }
}

/** A list field that must be an array of objects; returns [] (and a problem) otherwise. */
export function objList(obj, key, where, errors) {
  const v = obj[key];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) {
    problem(errors, where, key, 'should be a list', v);
    return [];
  }
  return v;
}
