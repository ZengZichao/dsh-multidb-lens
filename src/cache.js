/**
 * Small in-memory result cache for repeated selections.
 *
 * Only successful source outcomes are cached. A source that timed out or
 * failed is retried on the next search instead of serving a stale error.
 * Entries are keyed by source id, normalized query, smart/raw mode and the
 * fetched page size; the cache is per host process and never leaves it.
 */

/**
 * @param {{
 *   ttlMs?: number,
 *   maxEntries?: number,
 *   now?: () => number,
 * }} [options]
 */
export function createResultCache(options = {}) {
  const ttlMs = options.ttlMs ?? 5 * 60 * 1000
  const maxEntries = options.maxEntries ?? 200
  const now = options.now ?? Date.now
  const store = new Map()

  const keyOf = (sourceId, query, context = {}) => [
    sourceId,
    context.adaptive === true ? 'smart' : 'raw',
    context.limit ?? '',
    query,
  ].join('\u0000')

  return {
    /**
     * @param {string} sourceId
     * @param {string} query
     * @param {{ adaptive?: boolean, limit?: number }} [context]
     * @returns {{ id: string, status: 'ok', items: any[], total: number | null } | null}
     */
    get(sourceId, query, context) {
      const key = keyOf(sourceId, query, context)
      const entry = store.get(key)
      if (entry === undefined) return null
      if (entry.expiresAt <= now()) {
        store.delete(key)
        return null
      }
      // Refresh insertion order so frequently reused entries survive eviction.
      store.delete(key)
      store.set(key, entry)
      return {
        id: entry.id,
        status: 'ok',
        items: entry.items,
        total: entry.total,
      }
    },

    /**
     * @param {string} sourceId
     * @param {string} query
     * @param {{ adaptive?: boolean, limit?: number }} [context]
     * @param {{ id: string, status: string, items?: any[], total?: number | null }} outcome
     */
    set(sourceId, query, context, outcome) {
      if (outcome?.status !== 'ok') return
      const key = keyOf(sourceId, query, context)
      if (store.size >= maxEntries) {
        const oldest = store.keys().next().value
        if (oldest !== undefined) store.delete(oldest)
      }
      store.set(key, {
        id: outcome.id,
        items: Array.isArray(outcome.items) ? outcome.items : [],
        total: Number.isFinite(outcome.total) ? outcome.total : null,
        expiresAt: now() + ttlMs,
      })
    },

    clear() {
      store.clear()
    },

    get size() {
      return store.size
    },
  }
}
