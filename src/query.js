/**
 * Selection-text normalization shared by the host. The browser bundle carries
 * an equivalent copy for immediate UI feedback; the host always re-normalizes
 * because client input is untrusted.
 *
 * The rule is deliberately mechanical: trim, collapse every whitespace run to
 * one space, and cap at 200 Unicode code points. No spell checking, entity
 * extraction or query rewriting.
 */

export const MAX_QUERY_CHARS = 200

/**
 * @typedef {{ query: string, truncated: boolean, length: number }} NormalizedQuery
 */

/**
 * @param {unknown} raw
 * @returns {NormalizedQuery}
 */
export function normalizeSelection(raw) {
  if (typeof raw !== 'string') return { query: '', truncated: false, length: 0 }
  const collapsed = raw.replace(/\s+/gu, ' ').trim()
  if (collapsed === '') return { query: '', truncated: false, length: 0 }
  const points = Array.from(collapsed)
  if (points.length <= MAX_QUERY_CHARS) {
    return { query: collapsed, truncated: false, length: points.length }
  }
  return {
    query: points.slice(0, MAX_QUERY_CHARS).join(''),
    truncated: true,
    length: points.length,
  }
}
