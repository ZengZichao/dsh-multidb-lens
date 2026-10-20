/**
 * Plugin configuration for dsh-multidb-lens.
 *
 * The plugin deliberately has no dependency on schemastery: Cordis accepts any
 * StandardSchemaV1 object here, and a hand-written schema keeps the package
 * dependency-free. The only configurable value is the optional NCBI API key;
 * without it the host runs at NCBI's keyless rate (<= 3 requests/second).
 */

/** @typedef {{ ncbiApiKey: string, ncbiEmail: string }} PluginConfig */

const CONFIG_KEY = 'ncbiApiKey'
const EMAIL_KEY = 'ncbiEmail'

function issue(message, path) {
  return path === undefined ? { message } : { message, path: [path] }
}

/**
 * Minimal StandardSchemaV1-compatible validator. Cordis calls this before
 * `apply(ctx, config)`, so `apply` always receives the normalized object.
 */
export const Config = {
  '~standard': {
    version: 1,
    vendor: 'dsh-multidb-lens',
    validate(value) {
      if (value === undefined || value === null) {
        return { value: { [CONFIG_KEY]: '', [EMAIL_KEY]: '' } }
      }
      if (typeof value !== 'object' || Array.isArray(value)) {
        return { issues: [issue('插件配置必须是一个对象')] }
      }
      if (value[CONFIG_KEY] !== undefined && value[CONFIG_KEY] !== null && typeof value[CONFIG_KEY] !== 'string') {
        return { issues: [issue('ncbiApiKey 必须是字符串', CONFIG_KEY)] }
      }
      if (value[EMAIL_KEY] !== undefined && value[EMAIL_KEY] !== null && typeof value[EMAIL_KEY] !== 'string') {
        return { issues: [issue('ncbiEmail 必须是字符串', EMAIL_KEY)] }
      }
      return {
        value: {
          [CONFIG_KEY]: typeof value[CONFIG_KEY] === 'string' ? value[CONFIG_KEY].trim() : '',
          [EMAIL_KEY]: typeof value[EMAIL_KEY] === 'string' ? value[EMAIL_KEY].trim() : '',
        },
      }
    },
  },
}

/**
 * Resolve the effective credentials. Precedence:
 *   1. plugin config (`ncbiApiKey` / `ncbiEmail`)
 *   2. DSH_MULTIDB_LENS_NCBI_API_KEY / DSH_MULTIDB_LENS_NCBI_EMAIL
 *   3. NCBI_API_KEY / NCBI_EMAIL
 *
 * The resolved key is host-only. It is appended to NCBI request URLs but is
 * never included in any response, log line or client bundle.
 *
 * @param {Partial<PluginConfig> | undefined} config
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {PluginConfig}
 */
export function resolveConfig(config, env = process.env) {
  const pick = (...values) => {
    for (const value of values) {
      if (typeof value === 'string' && value.trim() !== '') return value.trim()
    }
    return ''
  }
  return {
    ncbiApiKey: pick(config?.ncbiApiKey, env.DSH_MULTIDB_LENS_NCBI_API_KEY, env.NCBI_API_KEY),
    ncbiEmail: pick(config?.ncbiEmail, env.DSH_MULTIDB_LENS_NCBI_EMAIL, env.NCBI_EMAIL),
  }
}

/**
 * Remove anything that could look like the configured NCBI key from a string
 * before it reaches a log line. The key is URL-encoded in requests, so both
 * the raw and encoded spellings are scrubbed.
 *
 * @param {string} text
 * @param {string} apiKey
 * @returns {string}
 */
export function scrubSecret(text, apiKey) {
  let out = String(text)
  if (apiKey !== '') {
    out = out.split(apiKey).join('[redacted]')
    const encoded = encodeURIComponent(apiKey)
    if (encoded !== apiKey) out = out.split(encoded).join('[redacted]')
  }
  return out.replace(/([?&]api_key=)[^&\s]+/gi, '$1[redacted]')
}
