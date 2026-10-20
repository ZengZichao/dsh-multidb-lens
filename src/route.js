/**
 * Host-side HTTP route.
 *
 * Request:  POST /plugins/dsh-multidb-lens/search
 *           { "query": "...", "source"?: "<id>", "sources"?: ["<id>", ...],
 *             "adaptive"?: true | false }
 *           `source` runs single-database mode; `sources` narrows all mode;
 *           omitting both searches every registered database. `adaptive`
 *           defaults to true and enables per-provider query rewriting.
 * Response: application/x-ndjson stream, one JSON event per line:
 *   { type: "meta", query, truncated, mode, sourceId, sourceIds, adaptive,
 *     queryKind, queryLabel, detectedValue, sequenceType, sources: [...] }
 *   { type: "source", id, status: "ok" | "error", ... }
 *   { type: "done", elapsedMs }
 *   { type: "fatal", error }
 *
 * Streaming is what makes the loading requirement real: the route writes each
 * source event as soon as that source settles, so the UI never waits for the
 * slowest database before showing the fastest one.
 */

import { searchAll } from './aggregate.js'
import { analyzeQuery } from './analyze.js'
import { createResultCache } from './cache.js'
import { normalizeSelection, MAX_QUERY_CHARS } from './query.js'
import { sourceDescriptors, SOURCE_DEFINITIONS } from './sources.js'

const MAX_BODY_BYTES = 16 * 1024
const SOURCE_IDS = new Set(SOURCE_DEFINITIONS.map((source) => source.id))
/** Fetch a page large enough for the UI's 5/10/20 per-source selectors. */
const FETCH_LIMIT = 20
/** Direct callers may send a larger selection; the host still caps it at 200. */
const MAX_RAW_QUERY_CHARS = 4000

const STREAM_HEADERS = {
  'content-type': 'application/x-ndjson; charset=utf-8',
  'cache-control': 'no-store, no-transform',
  'x-content-type-options': 'nosniff',
  'x-accel-buffering': 'no',
  'connection': 'keep-alive',
}

function sendJson(res, status, body) {
  if (res.writableEnded) return
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function readJsonBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    let size = 0
    let tooLarge = false
    const chunks = []
    req.on('data', (chunk) => {
      if (tooLarge) return
      size += chunk.length
      if (size > limitBytes) {
        tooLarge = true
        const error = new Error('请求体过大')
        error.status = 413
        reject(error)
        req.resume()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (tooLarge) return
      const text = Buffer.concat(chunks).toString('utf8')
      if (text.trim() === '') {
        resolve({})
        return
      }
      try {
        const value = JSON.parse(text)
        resolve(value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {})
      } catch {
        const error = new Error('请求体不是合法 JSON')
        error.status = 400
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

/**
 * Create the Node request handler. `config` is the resolved host config;
 * `searchOptions` is a test seam only (it is never populated by the plugin
 * entry from client input).
 *
 * @param {{
 *   config?: { ncbiApiKey?: string, ncbiEmail?: string },
 *   searchOptions?: Record<string, any>,
 *   cache?: ReturnType<typeof createResultCache>,
 *   logger?: { info?: Function, warn?: Function },
 * }} [options]
 */
export function createSearchHandler(options = {}) {
  const config = options.config ?? {}
  const searchOptions = options.searchOptions ?? {}
  const resultCache = options.cache ?? createResultCache()

  return async function searchHandler(req, res) {
    if (req.method !== 'POST') {
      res.setHeader?.('allow', 'POST')
      sendJson(res, 405, { ok: false, error: 'method not allowed' })
      return
    }

    // Defense in depth: a same-origin page is the only intended caller. Missing
    // headers (curl, tests, some embedded webviews) are allowed.
    const site = req.headers?.['sec-fetch-site']
    if (typeof site === 'string' && site !== 'same-origin' && site !== 'same-site' && site !== 'none') {
      sendJson(res, 403, { ok: false, error: 'cross-site request refused' })
      return
    }

    let body
    try {
      body = await readJsonBody(req, MAX_BODY_BYTES)
    } catch (error) {
      sendJson(res, Number.isFinite(error?.status) ? error.status : 400, {
        ok: false,
        error: error instanceof Error ? error.message : '无效请求',
      })
      return
    }

    const raw = body.query
    if (typeof raw !== 'string') {
      sendJson(res, 400, { ok: false, error: '缺少 query 字符串' })
      return
    }
    if (raw.length > MAX_RAW_QUERY_CHARS) {
      sendJson(res, 413, { ok: false, error: '选区过长' })
      return
    }
    const normalized = normalizeSelection(raw)
    if (normalized.query === '') {
      sendJson(res, 400, { ok: false, error: '检索词为空' })
      return
    }

    if (body.adaptive !== undefined && typeof body.adaptive !== 'boolean') {
      sendJson(res, 400, { ok: false, error: 'adaptive 必须是布尔值' })
      return
    }
    const adaptive = body.adaptive !== false

    const rawSource = body.source
    let mode = 'all'
    let sourceId = null
    let sourceIds
    if (rawSource !== undefined && rawSource !== null && rawSource !== '' && rawSource !== 'all') {
      if (typeof rawSource !== 'string' || !SOURCE_IDS.has(rawSource)) {
        sendJson(res, 400, { ok: false, error: '未知数据库' })
        return
      }
      mode = 'single'
      sourceId = rawSource
      sourceIds = [sourceId]
    } else if (body.sources !== undefined) {
      if (!Array.isArray(body.sources) || body.sources.length === 0 || body.sources.length > SOURCE_DEFINITIONS.length) {
        sendJson(res, 400, { ok: false, error: 'sources 必须是非空数据库 ID 数组' })
        return
      }
      const selected = []
      const seen = new Set()
      for (const id of body.sources) {
        if (typeof id !== 'string' || !SOURCE_IDS.has(id)) {
          sendJson(res, 400, { ok: false, error: '未知数据库' })
          return
        }
        if (seen.has(id)) continue
        seen.add(id)
        selected.push(id)
      }
      if (selected.length === 0) {
        sendJson(res, 400, { ok: false, error: 'sources 必须是非空数据库 ID 数组' })
        return
      }
      sourceIds = selected
    }

    const analysis = analyzeQuery(normalized.query)
    const descriptors = sourceDescriptors().filter(
      (descriptor) => sourceIds === undefined || sourceIds.includes(descriptor.id),
    )
    const detectedValue = Array.from(analysis.value).length > 80
      ? `${Array.from(analysis.value).slice(0, 77).join('')}…`
      : analysis.value

    let closed = false
    const abort = new AbortController()
    const onClose = () => {
      if (res.writableEnded) return
      closed = true
      abort.abort()
    }
    res.on('close', onClose)

    res.writeHead(200, STREAM_HEADERS)
    res.flushHeaders?.()
    const startedAt = Date.now()

    const write = (event) => {
      if (closed || res.writableEnded) return
      try {
        res.write(`${JSON.stringify(event)}\n`)
      } catch {
        closed = true
      }
    }

    write({
      type: 'meta',
      query: normalized.query,
      truncated: normalized.truncated,
      length: normalized.length,
      maxQueryChars: MAX_QUERY_CHARS,
      mode,
      sourceId,
      sourceIds: sourceIds ?? null,
      adaptive,
      queryKind: analysis.kind,
      queryLabel: analysis.label,
      detectedValue,
      sequenceType: analysis.sequenceType ?? null,
      sources: descriptors,
    })

    try {
      const outcomes = await searchAll(normalized.query, {
        ...searchOptions,
        limit: searchOptions.limit ?? FETCH_LIMIT,
        sourceIds,
        adaptive,
        analysis: adaptive ? analysis : null,
        cache: resultCache,
        ncbiApiKey: config.ncbiApiKey ?? '',
        ncbiEmail: config.ncbiEmail ?? '',
        signal: abort.signal,
        onSourceSettled: (outcome) => {
          if (outcome.status === 'ok') {
            write({
              type: 'source',
              id: outcome.id,
              status: 'ok',
              elapsedMs: outcome.elapsedMs,
              cached: outcome.cached === true,
              items: outcome.items,
              total: outcome.total,
            })
          } else {
            write({
              type: 'source',
              id: outcome.id,
              status: 'error',
              elapsedMs: outcome.elapsedMs,
              error: outcome.error,
            })
          }
        },
      })
      const statusText = outcomes
        .map((item) => `${item.id}=${item.status}${item.status === 'error' ? `(${item.error?.code ?? 'unknown'})` : ''}`)
        .join(' ')
      options.logger?.info?.(
        `[dsh-multidb-lens] ${mode}${sourceId === null ? '' : `(${sourceId})`} search finished in ${Date.now() - startedAt} ms: ${statusText}`,
      )
      write({ type: 'done', elapsedMs: Date.now() - startedAt })
    } catch (error) {
      // searchAll is designed not to reach here. If a future bug does, keep the
      // stream well-formed and never let the rejection escape the request.
      options.logger?.warn?.(
        `[dsh-multidb-lens] aggregate failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      )
      write({ type: 'fatal', error: { message: '检索聚合异常' } })
    } finally {
      if (!closed && !res.writableEnded) {
        try {
          res.end()
        } catch {
          // socket already gone
        }
      }
      res.off?.('close', onClose)
    }
  }
}
