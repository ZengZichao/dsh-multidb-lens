/**
 * dsh-multidb-lens — host half (Cordis plugin).
 *
 * The host owns every outbound request, the optional NCBI API key and the
 * aggregation route. The browser half only opens the selection menu, streams
 * this route and renders the returned cards inside a sandboxed iframe.
 *
 * No external dependencies: the HTTP client is Node's built-in fetch, and the
 * plugin config uses the StandardSchemaV1 shape Cordis already understands.
 */

import { Config, resolveConfig } from './config.js'
import { createSearchHandler } from './route.js'

export { Config }

export const name = 'dsh-multidb-lens'

/** Primary and compatibility paths tried by the browser half, in order. */
export const ROUTES = [
  '/plugins/dsh-multidb-lens/search',
  '/api/multidb-lens/search',
]

/**
 * Register one exact route on the web carrier.
 *
 * Two spellings are attempted because different dsh compositions expose the
 * route table either on `ctx.webServer` or on the connection operator's own
 * Cordis scope. The first successful registration wins.
 *
 * @param {any} ctx
 * @param {string} path
 * @param {(req: any, res: any) => Promise<void>} handler
 * @returns {{ dispose?: () => void, error?: unknown }}
 */
function tryRegisterRoute(ctx, path, handler) {
  const attempts = []
  try {
    const webServer = ctx.get?.('webServer')
    if (webServer !== undefined && typeof webServer.register === 'function') {
      attempts.push(() => webServer.register({ kind: 'exact', path, handler }))
    }
  } catch {
    // continue with the connection carrier
  }
  try {
    const operatorCtx = ctx.get?.('connection')?.operator?.ctx
    const operatorWeb = operatorCtx?.get?.('webServer')
    if (operatorWeb !== undefined && typeof operatorWeb.register === 'function') {
      attempts.push(() => operatorWeb.register({ kind: 'exact', path, handler }))
    }
  } catch {
    // no connection scope
  }

  let lastError
  for (const attempt of attempts) {
    try {
      const dispose = attempt()
      return { dispose: typeof dispose === 'function' ? dispose : () => {} }
    } catch (error) {
      lastError = error
    }
  }
  return {
    error: lastError ?? new Error('webServer service is unavailable'),
  }
}

/**
 * Mount both route spellings. At least one must succeed.
 *
 * @param {any} ctx
 * @param {(req: any, res: any) => Promise<void>} handler
 * @returns {() => void} disposer
 */
function mountRoutes(ctx, handler) {
  const disposers = []
  for (const path of ROUTES) {
    const result = tryRegisterRoute(ctx, path, handler)
    if (typeof result.dispose === 'function') {
      disposers.push(result.dispose)
      ctx.logger?.info?.(`[dsh-multidb-lens] route registered: ${path}`)
    } else {
      ctx.logger?.warn?.(
        `[dsh-multidb-lens] could not register ${path}: ${result.error instanceof Error ? result.error.message : 'unknown error'}`,
      )
    }
  }
  if (disposers.length === 0) {
    throw new Error('dsh-multidb-lens could not register a search route')
  }
  return () => {
    for (const dispose of disposers.splice(0)) {
      try {
        dispose()
      } catch {
        // already released
      }
    }
  }
}

/**
 * Cordis entry.
 *
 * @param {any} ctx
 * @param {{ ncbiApiKey?: string, ncbiEmail?: string } | undefined} rawConfig
 */
export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig)
  ctx.logger?.info?.(
    `[dsh-multidb-lens] mounted; NCBI API key ${config.ncbiApiKey === '' ? 'absent (3 req/s keyless limit)' : 'configured (still using the conservative 3 req/s queue)'}`,
  )

  const handler = createSearchHandler({
    config,
    logger: ctx.logger,
  })

  const mount = (hostCtx) => {
    if (hostCtx.get?.('webServer') === undefined) {
      hostCtx.logger?.warn?.('[dsh-multidb-lens] webServer is unavailable; search route not registered')
      return
    }
    const release = mountRoutes(hostCtx, handler)
    if (typeof hostCtx.effect === 'function') {
      hostCtx.effect(() => release, 'dsh-multidb-lens: search routes')
    }
  }

  if (ctx.get?.('webServer') !== undefined) {
    mount(ctx)
    return
  }
  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (hostCtx) => mount(hostCtx))
  } else {
    ctx.logger?.warn?.('[dsh-multidb-lens] no webServer and no ctx.inject; search route not registered')
  }
}
