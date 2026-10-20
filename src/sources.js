/**
 * Database adapters and the source registry.
 *
 * Ten public sources cover protein records (NCBI, UniProt), microbial ecology
 * and evolution (GTDB, BacDive, SILVA, LPSN, SeqCode), and literature
 * (PubMed, Europe PMC, OpenAlex). The `SOURCE_DEFINITIONS` array is the
 * extension seam: adding another database means adding one entry with a `run`
 * function and a display descriptor, not changing the aggregator or the route.
 */

import { buildSourceQuery } from './analyze.js'
import { fetchJson, fetchText, SourceError } from './http.js'
import { between, cleanText, collapseText, parseCount, stripTagsKeepingAlt } from './html.js'
import { abortableSleep, ncbiRateLimiter } from './rate-limit.js'

/**
 * Default NCBI database. The task allows either `protein` or `nucleotide`;
 * `protein` pairs naturally with UniProtKB and its esummary fields carry the
 * accession, title, organism and length used by the result cards. Change this
 * constant to `'nucleotide'` to search nuccore instead; NCBI_LINK_BASE below
 * already has the matching public page.
 */
export const NCBI_DB = 'protein'

const NCBI_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'
const NCBI_LINK_BASE = {
  protein: 'https://www.ncbi.nlm.nih.gov/protein/',
  nucleotide: 'https://www.ncbi.nlm.nih.gov/nuccore/',
}

const UNIPROT_SEARCH = 'https://rest.uniprot.org/uniprotkb/search'
const UNIPROT_LINK_BASE = 'https://www.uniprot.org/uniprotkb/'

/** GTDB's public FastAPI (the same backend that powers gtdb.ecogenomic.org). */
const GTDB_SEARCH = 'https://gtdb-api.ecogenomic.org/search/gtdb'
const GTDB_WEB = 'https://gtdb.ecogenomic.org'

/**
 * BacDive's REST API requires an account since 2025, but the public website
 * search stays open. The adapter reads the HTML result list; no key is needed.
 */
const BACDIVE_SEARCH = 'https://bacdive.dsmz.de/search'
const BACDIVE_STRAIN = 'https://bacdive.dsmz.de/strain/'

/** SILVA's search backend; the endpoint returns JSON with embedded HTML. */
const SILVA_WS = 'https://legatum.arb-silva.de/WS/'
const SILVA_WEB = 'https://www.arb-silva.de'
const SILVA_DB = 'ssu-144'

/** LPSN and SeqCode expose searchable HTML pages only. */
const LPSN_SEARCH = 'https://lpsn.dsmz.de/search'
const LPSN_WEB = 'https://lpsn.dsmz.de'
const SEQCODE_SEARCH = 'https://registry.seqco.de/search'
const SEQCODE_WEB = 'https://seqco.de'

/** Literature databases. */
const PUBMED_LINK_BASE = 'https://pubmed.ncbi.nlm.nih.gov/'
const EUROPE_PMC_SEARCH = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search'
const EUROPE_PMC_WEB = 'https://europepmc.org/article'
const OPENALEX_SEARCH = 'https://api.openalex.org/works'
const DOI_LINK_BASE = 'https://doi.org/'

/** Compact result count: the first page only. */
export const DEFAULT_RESULT_LIMIT = 5

/** Per-source wall-clock budget. Each source owns its timer; 9 s is the core isolation bound. */
export const DEFAULT_SOURCE_TIMEOUT_MS = 9000

/**
 * @typedef {{
 *   id: string,
 *   title: string,
 *   description: string,
 *   url: string,
 * }} LensItem
 */

/**
 * @typedef {{ items: LensItem[], total: number | null }} SourceResult
 */

/**
 * @typedef {{
 *   signal?: AbortSignal,
 *   fetchImpl?: typeof fetch,
 *   ncbiApiKey?: string,
 *   ncbiEmail?: string,
 *   limit?: number,
 *   db?: string,
 *   limiter?: { schedule: (task: () => Promise<any>, signal?: AbortSignal) => Promise<any> },
 *   analysis?: import('./analyze.js').QueryAnalysis | null,
 *   silvaDb?: string,
 *   endpoints?: {
 *     ncbiBase?: string,
 *     uniprotSearch?: string,
 *     gtdbSearch?: string,
 *     bacdiveSearch?: string,
 *     silvaWs?: string,
 *     lpsnSearch?: string,
 *     seqcodeSearch?: string,
 *     europePmcSearch?: string,
 *     openAlexSearch?: string,
 *   },
 * }} SourceOptions
 */

function oneLine(value, max) {
  if (typeof value !== 'string') return ''
  const text = value.replace(/\s+/gu, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function toFiniteCount(value) {
  const number = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(number) && number >= 0 ? number : null
}

/**
 * One NCBI request, with a single polite retry when NCBI answers 429.
 *
 * @param {URL} url
 * @param {{ signal?: AbortSignal, fetchImpl?: typeof fetch, limiter: any }} context
 */
async function ncbiJson(url, context) {
  const attempt = () => context.limiter.schedule(
    () => fetchJson(url, { signal: context.signal, fetchImpl: context.fetchImpl }),
    context.signal,
  )
  try {
    return await attempt()
  } catch (error) {
    if (error instanceof SourceError && error.code === 'rate_limited') {
      // 429 is rare because requests are serialized at <= 3/s. If NCBI still
      // pushes back, wait one second and try exactly once more; the source's
      // 9 s timer still owns the overall deadline.
      await abortableSleep(1000, context.signal)
      return attempt()
    }
    throw error
  }
}

/**
 * Search NCBI Protein with the standard two-step E-utilities workflow.
 *
 * @param {string} query
 * @param {SourceOptions} [options]
 * @returns {Promise<SourceResult>}
 */
export async function searchNcbi(query, options = {}) {
  const db = options.db ?? NCBI_DB
  const limit = options.limit ?? DEFAULT_RESULT_LIMIT
  const base = (options.endpoints?.ncbiBase ?? NCBI_BASE).replace(/\/+$/u, '')
  const linkBase = NCBI_LINK_BASE[db] ?? NCBI_LINK_BASE.protein
  const context = {
    signal: options.signal,
    fetchImpl: options.fetchImpl,
    limiter: options.limiter ?? ncbiRateLimiter,
  }

  const searchParams = {
    db,
    term: buildSourceQuery('ncbi', query, options.analysis),
    retmode: 'json',
    retmax: String(limit),
    sort: 'relevance',
    tool: 'dsh-multidb-lens',
  }
  if (options.ncbiEmail) searchParams.email = options.ncbiEmail
  if (options.ncbiApiKey) searchParams.api_key = options.ncbiApiKey

  const searchUrl = new URL(`${base}/esearch.fcgi`)
  searchUrl.search = new URLSearchParams(searchParams).toString()
  const { data: searchData } = await ncbiJson(searchUrl, context)

  const esearch = searchData?.esearchresult
  if (esearch === null || typeof esearch !== 'object' || !Array.isArray(esearch.idlist)) {
    throw new SourceError('invalid_response', 'NCBI esearch 响应缺少 idlist')
  }
  const total = toFiniteCount(esearch.count)
  const ids = []
  const seen = new Set()
  for (const raw of esearch.idlist) {
    if (typeof raw !== 'string' || raw === '' || seen.has(raw)) continue
    seen.add(raw)
    ids.push(raw)
    if (ids.length >= limit) break
  }
  if (ids.length === 0) return { items: [], total }

  const summaryUrl = new URL(`${base}/esummary.fcgi`)
  const summaryParams = {
    db,
    id: ids.join(','),
    retmode: 'json',
    tool: 'dsh-multidb-lens',
  }
  if (options.ncbiEmail) summaryParams.email = options.ncbiEmail
  if (options.ncbiApiKey) summaryParams.api_key = options.ncbiApiKey
  summaryUrl.search = new URLSearchParams(summaryParams).toString()
  const { data: summaryData } = await ncbiJson(summaryUrl, context)

  const result = summaryData?.result
  if (result === null || typeof result !== 'object') {
    throw new SourceError('invalid_response', 'NCBI esummary 响应缺少 result')
  }
  const order = Array.isArray(result.uids) && result.uids.length > 0 ? result.uids : ids
  const items = []
  for (const uid of order) {
    const summary = result[uid]
    if (summary === null || typeof summary !== 'object') continue
    const accession = firstString(summary.accessionversion, summary.caption, summary.uid, uid)
    if (accession === '') continue
    const title = oneLine(firstString(summary.title, summary.caption, accession), 300)
    const description = describeNcbiSummary(summary, db)
    items.push({
      id: accession,
      title: title === '' ? accession : title,
      description,
      url: `${linkBase}${encodeURIComponent(accession)}`,
    })
    if (items.length >= limit) break
  }
  return { items, total }
}

/**
 * Clean a nomenclatural name whose markup wraps each word (LPSN/SeqCode).
 * Inserting spaces for tags is what keeps words apart, but it also puts spaces
 * inside quotation marks; remove only those.
 */
function cleanName(value, max = 200) {
  return cleanText(value, max)
    .replace(/\s*"\s*/gu, '"')
    .replace(/\s*“\s*/gu, '“')
    .replace(/\s*”\s*/gu, '”')
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

function describeNcbiSummary(summary, db) {
  const parts = []
  if (typeof summary.organism === 'string' && summary.organism.trim() !== '') {
    parts.push(summary.organism.trim())
  }
  if (Number.isFinite(summary.slen) && summary.slen > 0) {
    parts.push(`${summary.slen} ${db === 'nucleotide' ? 'bp' : 'aa'}`)
  }
  if (typeof summary.subtype === 'string' && summary.subtype !== ''
    && typeof summary.subname === 'string' && summary.subname !== '') {
    parts.push(`${summary.subtype}: ${summary.subname}`)
  }
  return parts.length > 0 ? oneLine(parts.join(' · '), 260) : `NCBI ${db} 条目`
}

function uniprotProteinName(entry) {
  const description = entry?.proteinDescription
  return firstString(
    description?.recommendedName?.fullName?.value,
    description?.submissionNames?.[0]?.fullName?.value,
    description?.alternativeNames?.[0]?.fullName?.value,
  )
}

function uniprotFunction(entry) {
  const comments = Array.isArray(entry?.comments) ? entry.comments : []
  for (const comment of comments) {
    if (comment?.commentType !== 'FUNCTION') continue
    const texts = Array.isArray(comment.texts) ? comment.texts : []
    for (const text of texts) {
      if (typeof text?.value === 'string' && text.value.trim() !== '') return text.value.trim()
    }
  }
  return ''
}

/**
 * Search UniProtKB with a compact `fields` selection.
 *
 * @param {string} query
 * @param {SourceOptions} [options]
 * @returns {Promise<SourceResult>}
 */
export async function searchUniProt(query, options = {}) {
  const limit = options.limit ?? DEFAULT_RESULT_LIMIT
  const endpoint = options.endpoints?.uniprotSearch ?? UNIPROT_SEARCH
  const url = new URL(endpoint)
  url.searchParams.set('query', buildSourceQuery('uniprot', query, options.analysis))
  url.searchParams.set('format', 'json')
  url.searchParams.set('size', String(limit))
  url.searchParams.set('fields', 'accession,protein_name,organism_name,cc_function')

  /** @type {{ data: any, response: Response }} */
  let payload
  try {
    payload = await fetchJson(url, { signal: options.signal, fetchImpl: options.fetchImpl })
  } catch (error) {
    const transient = error instanceof SourceError
      && (error.code === 'rate_limited' || (error.code === 'http_error' && error.status === 503))
    if (!transient) throw error
    await abortableSleep(1000, options.signal)
    payload = await fetchJson(url, { signal: options.signal, fetchImpl: options.fetchImpl })
  }
  const { data, response } = payload

  if (!Array.isArray(data?.results)) {
    throw new SourceError('invalid_response', 'UniProt 响应缺少 results')
  }
  const headerTotal = toFiniteCount(response.headers.get('x-total-results'))
  const items = []
  for (const entry of data.results) {
    if (entry === null || typeof entry !== 'object') continue
    const accession = firstString(entry.primaryAccession)
    if (accession === '') continue
    const name = uniprotProteinName(entry)
    const organism = firstString(entry.organism?.scientificName, entry.organism?.commonName)
    const func = uniprotFunction(entry)
    const descriptionParts = [organism, func].filter((part) => part !== '')
    items.push({
      id: accession,
      title: oneLine(name, 240) || '（未命名蛋白）',
      description: oneLine(descriptionParts.join(' · '), 260) || '暂无功能描述',
      url: `${UNIPROT_LINK_BASE}${encodeURIComponent(accession)}/entry`,
    })
    if (items.length >= limit) break
  }
  return { items, total: headerTotal }
}

/* ── microbiome / microbial-evolution databases ─────────────────────────── */

function splitRanks(value) {
  return String(value ?? '')
    .split(';')
    .map((rank) => rank.trim())
    .filter((rank) => rank !== '')
}

function rankLabel(rank) {
  return rank.replace(/^[a-z]__/u, '')
}

function gtdbTreeUrl(ranks) {
  if (ranks.length === 0) return `${GTDB_WEB}/`
  const target = [...ranks].reverse().find((rank) => rank.startsWith('s__'))
    ?? [...ranks].reverse().find((rank) => rank.startsWith('g__'))
    ?? ranks.at(-1)
  return `${GTDB_WEB}/tree?r=${encodeURIComponent(target)}`
}

/**
 * Search GTDB's genome index. Each hit is a genome assembly with its GTDB
 * lineage, which is the useful unit for microbial ecology (who is in this
 * species, and where does it sit in the tree).
 *
 * @param {string} query
 * @param {SourceOptions} [options]
 * @returns {Promise<SourceResult>}
 */
export async function searchGtdb(query, options = {}) {
  const limit = options.limit ?? DEFAULT_RESULT_LIMIT
  const endpoint = options.endpoints?.gtdbSearch ?? GTDB_SEARCH
  const url = new URL(endpoint)
  url.searchParams.set('search', buildSourceQuery('gtdb', query, options.analysis))
  url.searchParams.set('page', '1')
  url.searchParams.set('itemsPerPage', String(limit))

  const { data } = await fetchJson(url, { signal: options.signal, fetchImpl: options.fetchImpl })
  if (!Array.isArray(data?.rows)) {
    throw new SourceError('invalid_response', 'GTDB 响应缺少 rows')
  }
  const total = toFiniteCount(data.totalRows)
  const items = []
  const seen = new Set()
  for (const row of data.rows) {
    if (row === null || typeof row !== 'object') continue
    const accession = firstString(row.accession, row.gid)
    if (accession === '' || seen.has(accession)) continue
    seen.add(accession)
    const ranks = splitRanks(row.gtdbTaxonomy)
    const labels = ranks.map(rankLabel)
    const title = oneLine(firstString(row.ncbiOrgName, labels.at(-1), accession), 300) || accession
    const parts = []
    if (labels.length > 0) parts.push(labels.slice(-3).join(' › '))
    if (row.isGtdbSpeciesRep === true) parts.push('种代表基因组')
    if (row.isNcbiTypeMaterial === true) parts.push('NCBI 模式菌株')
    items.push({
      id: accession,
      title,
      description: oneLine(parts.join(' · '), 260) || 'GTDB 基因组记录',
      url: gtdbTreeUrl(ranks),
    })
    if (items.length >= limit) break
  }
  return { items, total }
}

/**
 * Search the public BacDive strain catalogue. The site's JSON API now needs an
 * account, so this adapter parses the same search page a browser sees.
 *
 * @param {string} query
 * @param {SourceOptions} [options]
 * @returns {Promise<SourceResult>}
 */
export async function searchBacDive(query, options = {}) {
  const limit = options.limit ?? DEFAULT_RESULT_LIMIT
  const endpoint = options.endpoints?.bacdiveSearch ?? BACDIVE_SEARCH
  const url = new URL(endpoint)
  url.searchParams.set('search', buildSourceQuery('bacdive', query, options.analysis))

  const { data: html } = await fetchText(url, { signal: options.signal, fetchImpl: options.fetchImpl })
  const text = String(html ?? '')
  const total = parseCount(/\bhits:\s*([\d.,]+)/iu.exec(text)?.[1])
  const items = []
  const seen = new Set()
  const rowPattern = /<li\s+class="searchresultrow[12][^"]*"\s*>([\s\S]*?)<\/li>/giu
  let row
  while ((row = rowPattern.exec(text)) !== null && items.length < limit) {
    const block = row[1]
    const link = /<a\s+href="\/strain\/(\d+)"[^>]*>([\s\S]*?)<\/a>/iu.exec(block)
    if (link === null || seen.has(link[1])) continue
    seen.add(link[1])
    const id = link[1]
    const name = cleanText(link[2], 200)
    const strainNumber = cleanText(/\bstrain number:\s*([^<]+)/iu.exec(block)?.[1] ?? '', 140)
    const designation = cleanText(/\bdesignation_header:\s*([^<]+)/iu.exec(block)?.[1] ?? '', 100)
    const typeStrain = /type strain:[\s\S]{0,240}?alt="Yes"/iu.test(block)
    const parts = []
    if (strainNumber !== '') parts.push(`菌株号 ${strainNumber}`)
    else if (designation !== '') parts.push(`菌株编号 ${designation}`)
    if (typeStrain) parts.push('模式菌株')
    items.push({
      id: `BacDive ${id}`,
      title: name === '' ? `BacDive ${id}` : name,
      description: oneLine(parts.join(' · '), 260) || 'BacDive 菌株记录',
      url: `${BACDIVE_STRAIN}${id}`,
    })
  }
  return { items, total }
}

function silvaSearchField(query) {
  const compact = query.replace(/\s+/gu, '')
  if (/^[A-Z]{1,4}\d{4,}(?:\.\d+)?$/iu.test(compact)) return 1
  if (/^(?:CP|NZ_|NC_|SRR|ERR|DRR|GCA_|GCF_)/iu.test(compact)) return 1
  return 0
}

/**
 * Search SILVA's SSU reference database. The web service answers with JSON
 * whose `searchResult` field is an HTML table; parse only the row cells.
 *
 * @param {string} query
 * @param {SourceOptions} [options]
 * @returns {Promise<SourceResult>}
 */
export async function searchSilva(query, options = {}) {
  const limit = options.limit ?? DEFAULT_RESULT_LIMIT
  const endpoint = options.endpoints?.silvaWs ?? SILVA_WS
  const db = options.silvaDb ?? SILVA_DB
  const term = buildSourceQuery('silva', query, options.analysis)
  const common = new URLSearchParams()
  common.set('tx_pmtree_pi1[type]', 'search')
  common.set('tx_pmtree_pi1[db]', db)
  common.append('tx_pmtree_pi1[qfield][]', String(silvaSearchField(term)))
  common.append('tx_pmtree_pi1[qtext][]', term)

  const statsBody = new URLSearchParams(common)
  statsBody.set('tx_pmtree_pi1[action]', 'stats')
  const resultBody = new URLSearchParams(common)
  resultBody.set('tx_pmtree_pi1[action]', 'result')
  resultBody.set('tx_pmtree_pi1[from]', '0')

  const requestOptions = {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    signal: options.signal,
    fetchImpl: options.fetchImpl,
  }
  // `action=stats` and `action=result` are separate calls in SILVA's own UI.
  // Run them together so the extra total count does not double the latency.
  const [statsOutcome, resultOutcome] = await Promise.allSettled([
    fetchText(endpoint, { ...requestOptions, body: statsBody.toString() }),
    fetchText(endpoint, { ...requestOptions, body: resultBody.toString() }),
  ])
  if (resultOutcome.status === 'rejected') throw resultOutcome.reason

  let total = null
  if (statsOutcome.status === 'fulfilled') {
    try {
      const statsPayload = JSON.parse(String(statsOutcome.value.data ?? '').trim())
      const stats = String(statsPayload?.searchStats ?? '')
      total = parseCount(/rRNA regions:\s*[\d.,]+\s*-\s*[\d.,]+\s*\/\s*([\d.,]+)/iu.exec(stats)?.[1])
    } catch {
      // A missing stats response only hides the total; the rows are still useful.
    }
  }

  let payload
  try {
    const trimmed = String(resultOutcome.value.data ?? '').trim()
    payload = JSON.parse(trimmed.startsWith('(') && trimmed.endsWith(')') ? trimmed.slice(1, -1) : trimmed)
  } catch {
    throw new SourceError('invalid_response', 'SILVA 响应不是合法的 JSON')
  }

  const resultHtml = String(payload?.searchResult ?? '')
  const items = []
  const rowPattern = /<tr\s+class="resultItem"\s+sid="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/giu
  let row
  while ((row = rowPattern.exec(resultHtml)) !== null && items.length < limit) {
    const block = row[2]
    const accession = cleanText(between(block, 'class="accessionNumber">', '</td>'), 60)
    if (accession === '') continue
    const organism = cleanText(between(block, 'class="organismName">', '</td>'), 200)
    const length = cleanText(between(block, 'class="sequenceLength">', '</td>'), 20)
    const qualities = [...block.matchAll(/\balt="([\d.]+%)"/giu)].map((match) => match[1])
    const taxonomy = stripTagsKeepingAlt(between(block, 'popuptext="', '"'))
      .split(';')
      .map((name) => collapseText(name, 80))
      .filter((name) => name !== '')
    const parts = []
    if (taxonomy.length > 0) parts.push(taxonomy.slice(-3).join(' › '))
    if (length !== '') parts.push(`${length} bp`)
    if (qualities.length > 0) parts.push(`质量 ${qualities.slice(0, 2).join('/')}`)
    items.push({
      id: accession,
      title: organism === '' ? accession : organism,
      description: oneLine(parts.join(' · '), 260) || 'SILVA rRNA 序列',
      url: `${SILVA_WEB}/browser/${encodeURIComponent(db)}/${encodeURIComponent(accession)}`,
    })
  }
  return { items, total }
}

const LPSN_STATUS = new Map([
  ['validly published under the icnp', 'ICNP 有效发表'],
  ['not validly published', '未有效发表'],
  ['not pro-validly published', '原核生物命名未有效发表'],
])

const LPSN_STATUS_SUFFIX = new Map([
  ['illegitimate name', '非法名称'],
  ['conserved name', '保留名称'],
  ['rejected name', '被否决名称'],
  ['emended', '修订'],
])

function translateLpsnStatus(raw) {
  const text = raw.trim()
  if (text === '') return ''
  const lower = text.toLowerCase()
  const exact = LPSN_STATUS.get(lower)
  if (exact !== undefined) return exact
  const compound = /^validly published under the icnp,\s*(.+)$/u.exec(lower)
  if (compound !== null) {
    const suffix = LPSN_STATUS_SUFFIX.get(compound[1].trim()) ?? compound[1].trim()
    return `ICNP 有效发表（${suffix}）`
  }
  return collapseText(text, 60)
}

/**
 * Search LPSN's nomenclatural catalogue. Results are grouped by rank on the
 * public search page; keep the rank, name and validity badge.
 *
 * @param {string} query
 * @param {SourceOptions} [options]
 * @returns {Promise<SourceResult>}
 */
export async function searchLpsn(query, options = {}) {
  const limit = options.limit ?? DEFAULT_RESULT_LIMIT
  const endpoint = options.endpoints?.lpsnSearch ?? LPSN_SEARCH
  const url = new URL(endpoint)
  url.searchParams.set('word', buildSourceQuery('lpsn', query, options.analysis))

  const { data: raw } = await fetchText(url, { signal: options.signal, fetchImpl: options.fetchImpl })
  const html = String(raw ?? '')
  const total = parseCount(/\(([\d,]+)\s+results?\)/iu.exec(html)?.[1])
  const items = []
  const seen = new Set()
  const linkPattern = /<a\s+href="\/([a-z-]+)\/([^"\/]+)"[^>]*\bclass="[^"]*\bcolor-[^"]*"[^>]*>([\s\S]*?)<\/a>/giu
  let link
  while ((link = linkPattern.exec(html)) !== null && items.length < limit) {
    const key = `${link[1]}/${link[2]}`
    if (seen.has(key)) continue
    seen.add(key)
    const name = cleanName(link[3])
    if (name === '') continue
    const tailEnd = html.indexOf('</li>', linkPattern.lastIndex)
    const tail = tailEnd < 0 ? '' : html.slice(linkPattern.lastIndex, tailEnd)
    const rawStatus = /<abbr\s+title="([^"]*)"/iu.exec(tail)?.[1] ?? ''
    const status = translateLpsnStatus(rawStatus)
    const parts = [link[1]]
    if (status !== '') parts.push(status)
    items.push({
      id: link[1],
      title: name,
      description: oneLine(parts.join(' · '), 260),
      url: `${LPSN_WEB}/${link[1]}/${encodeURIComponent(link[2])}`,
    })
  }
  return { items, total }
}

/**
 * Search the SeqCode Registry (genome-based names for uncultured prokaryotes).
 *
 * @param {string} query
 * @param {SourceOptions} [options]
 * @returns {Promise<SourceResult>}
 */
export async function searchSeqCode(query, options = {}) {
  const limit = options.limit ?? DEFAULT_RESULT_LIMIT
  const endpoint = options.endpoints?.seqcodeSearch ?? SEQCODE_SEARCH
  const url = new URL(endpoint)
  url.searchParams.set('q', buildSourceQuery('seqcode', query, options.analysis))
  url.searchParams.set('what', 'names')

  const { data: raw } = await fetchText(url, { signal: options.signal, fetchImpl: options.fetchImpl })
  const html = String(raw ?? '')
  const items = []
  const seen = new Set()
  const rowPattern = /<tr>\s*<th>\s*<a\s+href="\/names\/(\d+)"\s*>([\s\S]*?)<\/a>\s*<\/th>([\s\S]*?)<\/tr>/giu
  let row
  while ((row = rowPattern.exec(html)) !== null && items.length < limit) {
    if (seen.has(row[1])) continue
    seen.add(row[1])
    const name = cleanName(row[2])
    if (name === '') continue
    const cells = [...row[3].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/giu)]
      .map((match) => cleanText(match[1], 80))
      .filter((value) => value !== '')
    const reportedIn = cells[0] ?? ''
    const status = cells[1] ?? ''
    const parts = []
    if (status !== '') parts.push(status)
    if (reportedIn !== '' && reportedIn.toLowerCase() !== 'unknown' && reportedIn !== status) {
      parts.push(reportedIn)
    }
    items.push({
      id: `i:${row[1]}`,
      title: name,
      description: oneLine(['SeqCode Registry', ...parts].join(' · '), 260),
      url: `${SEQCODE_WEB}/i:${row[1]}`,
    })
  }
  return { items, total: null }
}

/* ── literature databases ──────────────────────────────────────────────── */

function doiLink(doi) {
  const path = doi
    .split('/')
    .map((part, index) => (index === 0 ? part : encodeURIComponent(part)))
    .join('/')
  return `${DOI_LINK_BASE}${path}`
}

function authorLine(names) {
  const clean = names
    .filter((name) => typeof name === 'string' && name.trim() !== '')
    .map((name) => name.trim())
  if (clean.length === 0) return ''
  if (clean.length <= 3) return clean.join(', ')
  return `${clean.slice(0, 3).join(', ')} et al.`
}

/**
 * Search PubMed through the same E-utilities pair used for NCBI Protein.
 * PubMed has its own database id (`pubmed`) and summary shape, but shares the
 * host's serial NCBI queue so a full search cannot exceed NCBI's rate limit.
 *
 * @param {string} query
 * @param {SourceOptions} [options]
 * @returns {Promise<SourceResult>}
 */
export async function searchPubMed(query, options = {}) {
  const limit = options.limit ?? DEFAULT_RESULT_LIMIT
  const base = (options.endpoints?.ncbiBase ?? NCBI_BASE).replace(/\/+$/u, '')
  const context = {
    signal: options.signal,
    fetchImpl: options.fetchImpl,
    limiter: options.limiter ?? ncbiRateLimiter,
  }

  const searchParams = {
    db: 'pubmed',
    term: buildSourceQuery('pubmed', query, options.analysis),
    retmode: 'json',
    retmax: String(limit),
    sort: 'relevance',
    tool: 'dsh-multidb-lens',
  }
  if (options.ncbiEmail) searchParams.email = options.ncbiEmail
  if (options.ncbiApiKey) searchParams.api_key = options.ncbiApiKey

  const searchUrl = new URL(`${base}/esearch.fcgi`)
  searchUrl.search = new URLSearchParams(searchParams).toString()
  const { data: searchData } = await ncbiJson(searchUrl, context)

  const esearch = searchData?.esearchresult
  if (esearch === null || typeof esearch !== 'object' || !Array.isArray(esearch.idlist)) {
    throw new SourceError('invalid_response', 'PubMed esearch 响应缺少 idlist')
  }
  const total = toFiniteCount(esearch.count)
  const ids = []
  const seen = new Set()
  for (const raw of esearch.idlist) {
    if (typeof raw !== 'string' || raw === '' || seen.has(raw)) continue
    seen.add(raw)
    ids.push(raw)
    if (ids.length >= limit) break
  }
  if (ids.length === 0) return { items: [], total }

  const summaryUrl = new URL(`${base}/esummary.fcgi`)
  const summaryParams = {
    db: 'pubmed',
    id: ids.join(','),
    retmode: 'json',
    tool: 'dsh-multidb-lens',
  }
  if (options.ncbiEmail) summaryParams.email = options.ncbiEmail
  if (options.ncbiApiKey) summaryParams.api_key = options.ncbiApiKey
  summaryUrl.search = new URLSearchParams(summaryParams).toString()
  const { data: summaryData } = await ncbiJson(summaryUrl, context)

  const result = summaryData?.result
  if (result === null || typeof result !== 'object') {
    throw new SourceError('invalid_response', 'PubMed esummary 响应缺少 result')
  }
  const order = Array.isArray(result.uids) && result.uids.length > 0 ? result.uids : ids
  const items = []
  for (const uid of order) {
    const summary = result[uid]
    if (summary === null || typeof summary !== 'object') continue
    const pmid = firstString(summary.uid, uid)
    if (pmid === '') continue
    const authors = Array.isArray(summary.authors)
      ? summary.authors.map((author) => author?.name)
      : []
    const year = /(?:19|20)\d{2}/u.exec(typeof summary.pubdate === 'string' ? summary.pubdate : '')?.[0] ?? ''
    const review = Array.isArray(summary.pubtype) && summary.pubtype.includes('Review') ? '综述' : ''
    const parts = [
      authorLine(authors),
      firstString(summary.source, summary.fulljournalname),
      year,
      review,
    ].filter((part) => part !== '')
    items.push({
      id: pmid,
      title: cleanText(summary.title, 300) || `PubMed ${pmid}`,
      description: oneLine(parts.join(' · '), 260) || 'PubMed 文献',
      url: `${PUBMED_LINK_BASE}${encodeURIComponent(pmid)}/`,
    })
    if (items.length >= limit) break
  }
  return { items, total }
}

/**
 * Search Europe PMC, which indexes PubMed, PMC full text and preprints
 * (bioRxiv/medRxiv). `resultType=lite` keeps the response small.
 *
 * @param {string} query
 * @param {SourceOptions} [options]
 * @returns {Promise<SourceResult>}
 */
export async function searchEuropePmc(query, options = {}) {
  const limit = options.limit ?? DEFAULT_RESULT_LIMIT
  const url = new URL(options.endpoints?.europePmcSearch ?? EUROPE_PMC_SEARCH)
  url.searchParams.set('query', buildSourceQuery('europepmc', query, options.analysis))
  url.searchParams.set('format', 'json')
  url.searchParams.set('pageSize', String(limit))
  url.searchParams.set('resultType', 'lite')

  const { data } = await fetchJson(url, { signal: options.signal, fetchImpl: options.fetchImpl })
  const records = data?.resultList?.result
  if (!Array.isArray(records)) {
    throw new SourceError('invalid_response', 'Europe PMC 响应缺少 resultList.result')
  }
  const total = toFiniteCount(data?.hitCount)
  const items = []
  for (const entry of records) {
    if (entry === null || typeof entry !== 'object') continue
    const recordId = firstString(entry.id)
    if (recordId === '') continue
    const pmid = firstString(entry.pmid)
    const doi = firstString(entry.doi)
    const source = firstString(entry.source, 'MED')
    const parts = [
      oneLine(firstString(entry.authorString), 120),
      oneLine(firstString(entry.journalTitle), 100),
      firstString(entry.pubYear),
      entry.isOpenAccess === 'Y' ? '开放获取' : '',
    ].filter((part) => part !== '')
    const url = pmid !== ''
      ? `${EUROPE_PMC_WEB}/MED/${encodeURIComponent(pmid)}`
      : `${EUROPE_PMC_WEB}/${encodeURIComponent(source)}/${encodeURIComponent(recordId)}`
    items.push({
      id: pmid !== '' ? `PMID ${pmid}` : (doi !== '' ? doi : recordId),
      title: cleanText(entry.title, 300) || '（无标题）',
      description: oneLine(parts.join(' · '), 260) || 'Europe PMC 文献',
      url,
    })
    if (items.length >= limit) break
  }
  return { items, total }
}

/**
 * Search OpenAlex's open scholarly index. DOIs become doi.org links; records
 * without a DOI link back to their OpenAlex work page.
 *
 * @param {string} query
 * @param {SourceOptions} [options]
 * @returns {Promise<SourceResult>}
 */
export async function searchOpenAlex(query, options = {}) {
  const limit = options.limit ?? DEFAULT_RESULT_LIMIT
  const analysis = options.analysis
  const url = new URL(options.endpoints?.openAlexSearch ?? OPENALEX_SEARCH)
  if (analysis?.kind === 'doi') {
    url.searchParams.set('filter', `doi:${analysis.value}`)
  } else if (analysis?.kind === 'pmid') {
    url.searchParams.set('filter', `pmid:${analysis.value}`)
  } else {
    url.searchParams.set('search', buildSourceQuery('openalex', query, analysis))
  }
  url.searchParams.set('per-page', String(limit))
  url.searchParams.set('select', 'id,doi,title,publication_year,authorships,primary_location,cited_by_count')

  const { data } = await fetchJson(url, { signal: options.signal, fetchImpl: options.fetchImpl })
  if (!Array.isArray(data?.results)) {
    throw new SourceError('invalid_response', 'OpenAlex 响应缺少 results')
  }
  const total = toFiniteCount(data?.meta?.count)
  const items = []
  for (const work of data.results) {
    if (work === null || typeof work !== 'object') continue
    const rawDoi = firstString(work.doi)
    const doi = rawDoi.replace(/^https?:\/\/doi\.org\//iu, '')
    const rawId = firstString(work.id)
    const shortId = rawId.replace(/^https?:\/\/openalex\.org\//iu, '')
    const id = doi !== '' ? doi : shortId
    const url = doi !== '' ? doiLink(doi) : rawId
    if (id === '' || url === '') continue
    const authors = Array.isArray(work.authorships)
      ? work.authorships.map((authorship) => authorship?.author?.display_name)
      : []
    const parts = [
      authorLine(authors),
      oneLine(firstString(work.primary_location?.source?.display_name), 100),
      Number.isFinite(work.publication_year) ? String(work.publication_year) : '',
      Number.isFinite(work.cited_by_count) && work.cited_by_count > 0 ? `被引 ${work.cited_by_count}` : '',
    ].filter((part) => part !== '')
    items.push({
      id,
      title: cleanText(work.title, 300) || '（无标题）',
      description: oneLine(parts.join(' · '), 260) || 'OpenAlex 文献',
      url,
    })
    if (items.length >= limit) break
  }
  return { items, total }
}

/**
 * UI-facing metadata only; internal endpoints/timeouts stay on the host.
 */
export function sourceDescriptors() {
  return [
    {
      id: 'ncbi',
      name: 'NCBI Protein',
      subtitle: `NCBI E-utilities · ${NCBI_DB}`,
      homepage: NCBI_LINK_BASE[NCBI_DB] ?? NCBI_LINK_BASE.protein,
    },
    {
      id: 'uniprot',
      name: 'UniProtKB',
      subtitle: 'UniProt REST API',
      homepage: 'https://www.uniprot.org/uniprotkb',
    },
    {
      id: 'gtdb',
      name: 'GTDB',
      subtitle: '基因组分类数据库 · 细菌/古菌',
      homepage: 'https://gtdb.ecogenomic.org/',
    },
    {
      id: 'bacdive',
      name: 'BacDive',
      subtitle: 'DSMZ 菌株表型数据库',
      homepage: 'https://bacdive.dsmz.de/',
    },
    {
      id: 'silva',
      name: 'SILVA',
      subtitle: 'rRNA 参考序列 · SSU',
      homepage: 'https://www.arb-silva.de/',
    },
    {
      id: 'lpsn',
      name: 'LPSN',
      subtitle: '原核生物命名名录',
      homepage: 'https://lpsn.dsmz.de/',
    },
    {
      id: 'seqcode',
      name: 'SeqCode',
      subtitle: '未培养原核生物基因组命名',
      homepage: 'https://registry.seqco.de/',
    },
    {
      id: 'pubmed',
      name: 'PubMed',
      subtitle: '生物医学文献 · MEDLINE',
      homepage: 'https://pubmed.ncbi.nlm.nih.gov/',
    },
    {
      id: 'europepmc',
      name: 'Europe PMC',
      subtitle: '生命科学文献 · 预印本',
      homepage: 'https://europepmc.org/',
    },
    {
      id: 'openalex',
      name: 'OpenAlex',
      subtitle: '开放学术文献索引',
      homepage: 'https://openalex.org/',
    },
  ]
}

/**
 * Source registry. Each entry is independent: the aggregator never shares a
 * promise, result array or error between entries.
 */
export const SOURCE_DEFINITIONS = [
  {
    id: 'ncbi',
    name: 'NCBI Protein',
    run: searchNcbi,
  },
  {
    id: 'uniprot',
    name: 'UniProtKB',
    run: searchUniProt,
  },
  {
    id: 'gtdb',
    name: 'GTDB',
    // The GTDB API is sometimes slow on cold cache (observed 6.5 s live).
    timeoutMs: 15000,
    run: searchGtdb,
  },
  {
    id: 'bacdive',
    name: 'BacDive',
    run: searchBacDive,
  },
  {
    id: 'silva',
    name: 'SILVA',
    timeoutMs: 12000,
    run: searchSilva,
  },
  {
    id: 'lpsn',
    name: 'LPSN',
    run: searchLpsn,
  },
  {
    id: 'seqcode',
    name: 'SeqCode',
    timeoutMs: 12000,
    run: searchSeqCode,
  },
  {
    id: 'pubmed',
    name: 'PubMed',
    // PubMed shares the serial NCBI queue with NCBI Protein in all mode.
    timeoutMs: 15000,
    run: searchPubMed,
  },
  {
    id: 'europepmc',
    name: 'Europe PMC',
    run: searchEuropePmc,
  },
  {
    id: 'openalex',
    name: 'OpenAlex',
    run: searchOpenAlex,
  },
]
