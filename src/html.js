/**
 * Small, dependency-free HTML text helpers used by the sources that only
 * expose an HTML search page (BacDive, LPSN, SeqCode) or embed an HTML table
 * inside a JSON response (SILVA).
 *
 * These helpers never build HTML: they only reduce fetched markup to plain
 * text for the result cards.
 */

const NAMED_ENTITIES = {
  amp: '&',
  apos: "'",
  gt: '>',
  hellip: '…',
  lt: '<',
  nbsp: ' ',
  quot: '"',
}

/**
 * Decode the entity forms the provider pages actually use, including numeric
 * references (LPSN uses emoji entities for nomenclatural status).
 *
 * @param {string} value
 * @returns {string}
 */
export function decodeEntities(value) {
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (match, entity) => {
    if (entity[0] === '#') {
      const hex = entity[1] === 'x' || entity[1] === 'X'
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10)
      if (!Number.isFinite(code)) return match
      try {
        return String.fromCodePoint(code)
      } catch {
        return match
      }
    }
    const named = NAMED_ENTITIES[entity.toLowerCase()]
    return named === undefined ? match : named
  })
}

/**
 * Strip tags and decode entities. Tags become spaces so inline markup
 * (`<I>Escherichia</I> <I>coli</I>`) does not glue words together.
 *
 * @param {string} value
 * @returns {string}
 */
export function stripTags(value) {
  return decodeEntities(String(value).replace(/<[^>]*>/gu, ' '))
}

/**
 * Like stripTags, but keeps the `alt` text of `<img>` tags. SILVA encodes its
 * taxonomy separator as `<img alt=";">`, so dropping every tag would merge the
 * lineage into one word.
 *
 * @param {string} value
 * @returns {string}
 */
export function stripTagsKeepingAlt(value) {
  const withAlt = String(value).replace(
    /<img\b[^>]*\balt=(?:"([^"]*)"|'([^']*)')[^>]*>/giu,
    (_match, doubleQuoted, singleQuoted) => doubleQuoted ?? singleQuoted ?? '',
  )
  return decodeEntities(withAlt.replace(/<[^>]*>/gu, ' '))
}

/**
 * Collapse whitespace and cap the text with an ellipsis.
 *
 * @param {string} value
 * @param {number} max
 * @returns {string}
 */
export function collapseText(value, max) {
  const text = String(value).replace(/\s+/gu, ' ').trim()
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 1))}…`
}

/**
 * Return clean text for an HTML fragment.
 *
 * @param {string} value
 * @param {number} [max]
 * @returns {string}
 */
export function cleanText(value, max = 300) {
  return collapseText(stripTags(value), max)
}

/**
 * Return the substring between two literal markers, or '' when either marker
 * is missing. A tiny stand-in for a DOM parser; provider markup is regular.
 *
 * @param {string} value
 * @param {string} start
 * @param {string} end
 * @returns {string}
 */
export function between(value, start, end) {
  const text = String(value)
  const from = text.indexOf(start)
  if (from < 0) return ''
  const begin = from + start.length
  const to = text.indexOf(end, begin)
  return to < 0 ? '' : text.slice(begin, to)
}

/**
 * Parse a count string that may contain thousands separators or decoration.
 *
 * @param {unknown} value
 * @returns {number | null}
 */
export function parseCount(value) {
  const digits = String(value ?? '').replace(/[^\d]/gu, '')
  if (digits === '') return null
  const number = Number.parseInt(digits, 10)
  return Number.isFinite(number) && number >= 0 ? number : null
}
