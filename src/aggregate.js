/**
 * Aggregation layer.
 *
 * Two hard acceptance points live here:
 *   1. every source is executed independently and collected with
 *      `Promise.allSettled` — one rejected source never rejects the batch;
 *   2. every source has its own wall-clock timeout, enforced by an
 *      AbortController plus a racing timer, so a hung provider is abandoned at
 *      9 s while the other source's result can already be displayed.
 *
 * `onSourceSettled` fires the moment each source settles. The HTTP route uses
 * it to stream one event per source, which is what lets the UI show a fast
 * database while a second database is still loading or timing out.
 */

import { abortError } from './rate-limit.js'
import {
  DEFAULT_RESULT_LIMIT,
  DEFAULT_SOURCE_TIMEOUT_MS,
  SOURCE_DEFINITIONS,
} from './sources.js'

export class SourceTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`source timed out after ${timeoutMs} ms`)
    this.name = 'SourceTimeoutError'
    this.code = 'timeout'
  }
}

function combineSignals(signals) {
  if (signals.length === 1) return signals[0]
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(signals)
  const controller = new AbortController()
  const onAbort = (event) => {
    cleanup()
    controller.abort(event.target?.reason)
  }
  const cleanup = () => {
    for (const signal of signals) signal.removeEventListener('abort', onAbort)
  }
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason)
      break
    }
    signal.addEventListener('abort', onAbort, { once: true })
  }
  return controller.signal
}

/**
 * Run one source under its own timeout. The race is deliberate: even a source
 * implementation that ignores its AbortSignal cannot hold the UI past the
 * deadline.
 *
 * @param {{ id: string, name: string, run: Function }} source
 * @param {string} query
 * @param {Record<string, any>} options
 */
async function runSource(source, query, options) {
  if (options.signal?.aborted) throw abortError(options.signal)
  const timeoutMs = source.timeoutMs ?? options.sourceTimeoutMs ?? DEFAULT_SOURCE_TIMEOUT_MS
  const controller = new AbortController()
  const signals = options.signal ? [controller.signal, options.signal] : [controller.signal]
  const signal = combineSignals(signals)
  let timer
  let timedOut = false

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true
      controller.abort(new SourceTimeoutError(timeoutMs))
      reject(new SourceTimeoutError(timeoutMs))
    }, timeoutMs)
  })

  try {
    return await Promise.race([
      source.run(query, { ...options, signal }),
      timeout,
    ])
  } catch (error) {
    // Aborting the request can make the provider promise reject with its own
    // AbortError in the same tick. Normalize that race to the timeout outcome
    // so the UI always says "该库查询超时" instead of a generic failure.
    if (timedOut) throw new SourceTimeoutError(timeoutMs)
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Translate an internal error into the tiny public error shape the iframe sees.
 * Raw provider bodies and URLs never cross this boundary.
 *
 * @param {any} error
 */
export function describeFailure(error) {
  const code = typeof error?.code === 'string'
    ? error.code
    : (error?.name === 'AbortError' ? 'aborted' : 'unknown')
  const status = Number.isFinite(error?.status) ? error.status : undefined

  if (code === 'timeout') {
    return { code, message: '该库查询超时', detail: '超过检索时限未返回' }
  }

  let detail = '未知错误'
  if (code === 'rate_limited') detail = 'HTTP 429：请求过于频繁'
  else if (code === 'http_error') detail = status === undefined ? '上游返回错误' : `HTTP ${status}`
  else if (code === 'invalid_response') detail = '上游响应格式异常'
  else if (code === 'network') detail = '网络连接失败'
  else if (code === 'aborted') detail = '请求已取消'

  return {
    code,
    message: '该库查询失败',
    detail,
    ...(status === undefined ? {} : { status }),
  }
}

/**
 * Search every registered source in parallel and collect all outcomes.
 *
 * The returned array always contains one outcome per selected source:
 *   `{ id, status: 'ok', elapsedMs, items, total }`
 *   `{ id, status: 'error', elapsedMs, error }`
 *
 * `sourceIds` narrows the run to the listed databases, preserving registry
 * order. All mode passes nothing; single-database mode passes one id.
 *
 * @param {string} query
 * @param {{
 *   signal?: AbortSignal,
 *   fetchImpl?: typeof fetch,
 *   ncbiApiKey?: string,
 *   ncbiEmail?: string,
 *   ncbiDb?: string,
 *   limit?: number,
 *   sourceTimeoutMs?: number,
 *   sourceIds?: string[],
 *   adaptive?: boolean,
 *   cache?: { get: Function, set: Function },
 *   silvaDb?: string,
 *   endpoints?: Record<string, string>,
 *   limiter?: any,
 *   onSourceSettled?: (outcome: any) => void,
 * }} [options]
 * @returns {Promise<Array<Record<string, any>>>}
 */
export async function searchAll(query, options = {}) {
  const limit = options.limit ?? DEFAULT_RESULT_LIMIT
  const sourceTimeoutMs = options.sourceTimeoutMs ?? DEFAULT_SOURCE_TIMEOUT_MS
  const selected = Array.isArray(options.sourceIds)
    ? SOURCE_DEFINITIONS.filter((source) => options.sourceIds.includes(source.id))
    : SOURCE_DEFINITIONS
  const outcomes = new Array(selected.length)

  const emit = (index, outcome) => {
    outcomes[index] = outcome
    if (typeof options.onSourceSettled !== 'function') return
    try {
      options.onSourceSettled(outcome)
    } catch {
      // A closed response socket must never turn a successful search into a
      // source failure. Streaming is best-effort; the aggregate still settles.
    }
  }

  const cacheContext = { adaptive: options.adaptive === true, limit }

  // Do NOT use Promise.all here: `Promise.all` rejects on the first failure and
  // would discard the other database's result. Each task below settles into a
  // tracked promise, and Promise.allSettled collects all of them.
  const tracked = selected.map((source, index) => {
    const cached = options.cache?.get?.(source.id, query, cacheContext)
    if (cached !== null && cached !== undefined) {
      const outcome = {
        id: source.id,
        status: 'ok',
        elapsedMs: 0,
        cached: true,
        items: Array.isArray(cached.items) ? cached.items : [],
        total: Number.isFinite(cached.total) ? cached.total : null,
      }
      emit(index, outcome)
      return Promise.resolve(outcome)
    }

    const startedAt = Date.now()
    return runSource(source, query, { ...options, limit, sourceTimeoutMs }).then(
      (result) => {
        const outcome = {
          id: source.id,
          status: 'ok',
          elapsedMs: Date.now() - startedAt,
          items: Array.isArray(result?.items) ? result.items : [],
          total: Number.isFinite(result?.total) ? result.total : null,
        }
        options.cache?.set?.(source.id, query, cacheContext, outcome)
        emit(index, outcome)
        return outcome
      },
      (error) => {
        const outcome = {
          id: source.id,
          status: 'error',
          elapsedMs: Date.now() - startedAt,
          error: describeFailure(error),
        }
        emit(index, outcome)
        throw error
      },
    )
  })

  const settled = await Promise.allSettled(tracked)
  return settled.map((entry, index) => {
    if (entry.status === 'fulfilled') return entry.value
    if (outcomes[index] !== undefined) return outcomes[index]
    return {
      id: selected[index].id,
      status: 'error',
      elapsedMs: 0,
      error: describeFailure(entry.reason),
    }
  })
}
