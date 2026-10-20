/**
 * A tiny serial rate limiter for NCBI E-utilities.
 *
 * NCBI asks keyless clients to stay at or below 3 requests/second. All NCBI
 * requests from this plugin share one queue, so concurrent user searches cannot
 * multiply the outbound rate. 350 ms between request starts gives ~2.86 req/s.
 * An API key is supported (it raises NCBI's published allowance) but the plugin
 * intentionally keeps the conservative 3 req/s cadence.
 */

/** @param {number} ms */
function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * @param {AbortSignal | undefined} signal
 * @returns {Error}
 */
export function abortError(signal) {
  const reason = signal?.reason
  if (reason instanceof Error) return reason
  const error = new Error('请求已取消')
  error.name = 'AbortError'
  return error
}

/**
 * Sleep that rejects as soon as the signal aborts. Used for both the queue
 * spacing and provider retry back-off so a timed-out source never keeps a
 * pending request alive.
 *
 * @param {number} ms
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
export function abortableSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal))
      return
    }
    let timer
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      cleanup()
      reject(abortError(signal))
    }
    timer = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Create a FIFO limiter. Every scheduled task starts at least `minIntervalMs`
 * after the previous task started. A rejected task does not poison the queue.
 *
 * @param {{ minIntervalMs?: number, now?: () => number, sleep?: (ms: number, signal?: AbortSignal) => Promise<void> }} [options]
 */
export function createSerialRateLimiter(options = {}) {
  const minIntervalMs = options.minIntervalMs ?? 350
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? abortableSleep
  let tail = Promise.resolve()
  let lastStartedAt = -Infinity

  return {
    /**
     * @template T
     * @param {() => Promise<T>} task
     * @param {AbortSignal} [signal]
     * @returns {Promise<T>}
     */
    schedule(task, signal) {
      const run = async () => {
        if (signal?.aborted) throw abortError(signal)
        const wait = Math.max(0, lastStartedAt + minIntervalMs - now())
        if (wait > 0) await sleep(wait, signal)
        if (signal?.aborted) throw abortError(signal)
        lastStartedAt = now()
        return task()
      }
      const result = tail.then(run, run)
      tail = result.then(
        () => undefined,
        () => undefined,
      )
      return result
    },
  }
}

/** Process-wide NCBI queue: keyless 3 req/s ceiling. */
export const ncbiRateLimiter = createSerialRateLimiter({ minIntervalMs: 350 })
