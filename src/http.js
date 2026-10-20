/**
 * Outbound HTTP helpers. Every external request in this plugin goes through
 * this module on the Node host; the browser half only talks to the local dsh
 * route.
 */

const USER_AGENT = 'dsh-multidb-lens/0.1.0'

/**
 * Error with a stable code the aggregator can translate into a user-facing
 * failure without leaking request details.
 */
export class SourceError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {{ status?: number, detail?: string, cause?: unknown }} [options]
   */
  constructor(code, message, options = {}) {
    super(message)
    this.name = 'SourceError'
    this.code = code
    if (Number.isFinite(options.status)) this.status = options.status
    if (typeof options.detail === 'string' && options.detail !== '') this.detail = options.detail
    if (options.cause !== undefined) this.cause = options.cause
  }
}

/**
 * Collapse an error body to one short, printable line. Provider error pages are
 * sometimes HTML; this keeps them from bloating a UI detail line.
 *
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
function oneLine(text, max) {
  return String(text).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

/**
 * Perform one outbound request and normalize transport/HTTP failures. Only
 * public provider URLs are ever passed here.
 *
 * @param {URL | string} url
 * @param {{
 *   signal?: AbortSignal,
 *   fetchImpl?: typeof fetch,
 *   headers?: Record<string, string>,
 *   method?: string,
 *   body?: string,
 * }} [options]
 * @param {string} accept
 * @returns {Promise<Response>}
 */
async function request(url, options = {}, accept = 'application/json') {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    throw new SourceError('network', '运行时没有可用的 fetch 实现')
  }

  let response
  try {
    response = await fetchImpl(url, {
      method: options.method ?? 'GET',
      redirect: 'follow',
      signal: options.signal,
      ...(options.body === undefined ? {} : { body: options.body }),
      headers: {
        accept,
        'user-agent': USER_AGENT,
        ...options.headers,
      },
    })
  } catch (error) {
    if (options.signal?.aborted) {
      throw new SourceError('aborted', '请求已取消', { cause: error })
    }
    const causeCode = error && typeof error === 'object' && typeof error.cause?.code === 'string'
      ? error.cause.code
      : undefined
    throw new SourceError('network', '网络请求失败', {
      detail: causeCode,
      cause: error,
    })
  }

  if (!response.ok) {
    let detail
    try {
      detail = oneLine(await response.text(), 180)
    } catch {
      // An unreadable error body is still an HTTP failure.
    }
    // Release the body when it was not consumed.
    try {
      await response.body?.cancel()
    } catch {
      // ignore
    }
    const code = response.status === 429 ? 'rate_limited' : 'http_error'
    throw new SourceError(code, `HTTP ${response.status}`, {
      status: response.status,
      detail: detail === '' ? `HTTP ${response.status}` : detail,
    })
  }

  return response
}

/**
 * Fetch a JSON document and parse it. Used by the JSON APIs (NCBI, UniProt,
 * GTDB, SILVA's WS wrapper).
 *
 * @param {URL | string} url
 * @param {Parameters<typeof request>[1]} [options]
 * @returns {Promise<{ data: any, response: Response }>}
 */
export async function fetchJson(url, options = {}) {
  const response = await request(url, options, 'application/json')
  try {
    const data = await response.json()
    return { data, response }
  } catch (error) {
    throw new SourceError('invalid_response', '响应不是合法的 JSON', { cause: error })
  }
}

/**
 * Fetch a text/HTML document. Used by the providers that only publish HTML
 * search pages (BacDive, LPSN, SeqCode).
 *
 * @param {URL | string} url
 * @param {Parameters<typeof request>[1]} [options]
 * @returns {Promise<{ data: string, response: Response }>}
 */
export async function fetchText(url, options = {}) {
  const response = await request(url, options, 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8')
  try {
    const data = await response.text()
    return { data, response }
  } catch (error) {
    throw new SourceError('invalid_response', '响应无法读取', { cause: error })
  }
}
