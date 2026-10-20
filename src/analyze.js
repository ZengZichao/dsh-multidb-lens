/**
 * Selection analysis and per-database query construction.
 *
 * A selection is often more specific than a free-text phrase: a DOI, a PMID,
 * an accession or a sequence. Sending it verbatim to ten providers produces
 * noisy or empty results, so smart mode detects the entity once and lets each
 * adapter phrase the query in that provider's own syntax. Raw mode bypasses
 * this module entirely, which is why the UI keeps an explicit toggle.
 */

const DOI_PATTERN = /\b(10\.\d{4,9}\/[-._;()/:a-z0-9]+)/iu
const DOI_URL = /doi\.org\/(10\.[^\s?#]+)/iu
const PMID_URL = /pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/iu
const PMID_LABEL = /\bPMID[:\s#]*(\d{5,9})\b/iu
const UNIPROT_URL = /uniprot\.org\/(?:uniprotkb\/)?([A-Z0-9]{5,10})(?:\/|$)/iu
const NCBI_URL = /ncbi\.nlm\.nih\.gov\/(?:protein|nuccore|assembly|nucleotide)\/([A-Z0-9_.]+)/iu
const UNIPROT_ACCESSION = /\b([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})\b/u
const NCBI_ACCESSION = /\b([A-Z]{1,3}_?\d{5,}(?:\.\d+)?)\b/u

const TAXON_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'could', 'did', 'do',
  'does', 'explain', 'find', 'for', 'from', 'give', 'how', 'in', 'is', 'it',
  'of', 'on', 'or', 'search', 'show', 'that', 'the', 'these', 'this', 'those',
  'to', 'was', 'were', 'what', 'when', 'where', 'which', 'who', 'why', 'with',
  'would',
])

function stripTrailingPunctuation(value) {
  return value.replace(/[.,;:]+$/u, '')
}

function sequenceCandidate(raw) {
  const withoutHeaders = raw
    .split(/\r?\n/u)
    .filter((line) => !line.trim().startsWith('>'))
    .join('')
  const compact = withoutHeaders.replace(/\s+/gu, '')
  if (compact.length < 20) return null
  // A word-separated, lower-case phrase is prose or a taxon name, not a
  // sequence; sequences may be uppercase or pasted as one unbroken token.
  if (/\s/u.test(withoutHeaders.trim()) && /[a-z]/u.test(compact)) return null
  if (/^[ACGTUN]+$/iu.test(compact)) {
    return { value: compact, sequenceType: 'dna' }
  }
  const distinct = new Set(compact.toUpperCase())
  if (/^[ACDEFGHIKLMNPQRSTVWYBXZJUO*]+$/iu.test(compact) && distinct.size >= 10) {
    return { value: compact, sequenceType: 'protein' }
  }
  return null
}

function taxonCandidate(raw) {
  const text = raw.replace(/\s+/gu, ' ').trim()
  if (/^Candidatus\s+[A-Z][a-z-]+(?:\s+[a-z][a-z-]+)?$/u.test(text)) return text
  const words = text.split(' ')
  if (words.length < 1 || words.length > 4) return null
  if (!/^[A-Z][a-z-]{2,}$/u.test(words[0])) return null
  if (TAXON_STOPWORDS.has(words[0].toLowerCase())) return null
  for (const word of words.slice(1)) {
    if (TAXON_STOPWORDS.has(word.toLowerCase())) return null
    if (!/^(?:[a-z][a-z-]*|[A-Z0-9][A-Za-z0-9.-]*)$/u.test(word)) return null
  }
  return text
}

/**
 * @typedef {{
 *   kind: 'doi' | 'pmid' | 'uniprot' | 'accession' | 'sequence' | 'taxon' | 'text',
 *   value: string,
 *   label: string,
 *   sequenceType?: 'dna' | 'protein',
 * }} QueryAnalysis
 */

/**
 * Detect the most useful entity in the normalized selection. Order matters:
 * identifiers before sequences, sequences before taxon names, taxon names
 * before plain text.
 *
 * @param {string} raw
 * @returns {QueryAnalysis}
 */
export function analyzeQuery(raw) {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (text === '') return { kind: 'text', value: '', label: '' }

  const doiUrl = DOI_URL.exec(text)
  const doi = doiUrl === null ? DOI_PATTERN.exec(text) : null
  if (doiUrl !== null || doi !== null) {
    const value = stripTrailingPunctuation((doiUrl ?? doi)[1])
    return { kind: 'doi', value, label: 'DOI' }
  }

  const pmidUrl = PMID_URL.exec(text)
  const pmidLabel = PMID_LABEL.exec(text)
  if (pmidUrl !== null || pmidLabel !== null) {
    return { kind: 'pmid', value: (pmidUrl ?? pmidLabel)[1], label: 'PMID' }
  }

  const uniprotUrl = UNIPROT_URL.exec(text)
  const uniprot = uniprotUrl === null ? UNIPROT_ACCESSION.exec(text) : null
  if (uniprotUrl !== null || uniprot !== null) {
    return { kind: 'uniprot', value: (uniprotUrl ?? uniprot)[1].toUpperCase(), label: 'UniProt 登录号' }
  }

  const ncbiUrl = NCBI_URL.exec(text)
  const ncbi = ncbiUrl === null ? NCBI_ACCESSION.exec(text) : null
  if (ncbiUrl !== null || ncbi !== null) {
    const value = (ncbiUrl ?? ncbi)[1]
    const label = /^(?:GCA|GCF)_/iu.test(value) ? '基因组登录号' : '登录号'
    return { kind: 'accession', value, label }
  }

  const taxon = taxonCandidate(text)
  if (taxon !== null) return { kind: 'taxon', value: taxon, label: '物种/分类名' }

  const sequence = sequenceCandidate(text)
  if (sequence !== null) {
    return {
      kind: 'sequence',
      value: sequence.value,
      label: sequence.sequenceType === 'dna' ? '核酸序列' : '蛋白序列',
      sequenceType: sequence.sequenceType,
    }
  }

  return { kind: 'text', value: text, label: '' }
}

function syntaxValue(value) {
  return String(value).replace(/["\\]/gu, '')
}

/**
 * Phrase one selection for one provider. Providers that do not have a useful
 * syntax for this entity receive the original query unchanged.
 *
 * @param {string} sourceId
 * @param {string} query
 * @param {QueryAnalysis | null | undefined} analysis
 * @returns {string}
 */
export function buildSourceQuery(sourceId, query, analysis) {
  if (!analysis || analysis.kind === 'text' || analysis.kind === 'sequence') return query
  const value = analysis.value
  const safe = syntaxValue(value)

  if (analysis.kind === 'doi') {
    if (sourceId === 'pubmed') return `"${safe}"[DOI]`
    if (sourceId === 'europepmc') return `DOI:"${safe}"`
    return query
  }

  if (analysis.kind === 'pmid') {
    if (sourceId === 'pubmed') return `${value}[PMID]`
    if (sourceId === 'europepmc') return `EXT_ID:${value}`
    return query
  }

  if (analysis.kind === 'uniprot') {
    if (sourceId === 'uniprot' || sourceId === 'ncbi') return value
    return query
  }

  if (analysis.kind === 'accession') {
    if (sourceId === 'ncbi' || sourceId === 'pubmed' || sourceId === 'gtdb' || sourceId === 'silva') return value
    return query
  }

  if (analysis.kind === 'taxon') {
    if (sourceId === 'ncbi') return `"${safe}"[Organism]`
    if (sourceId === 'uniprot') return `organism_name:"${safe}"`
    if (sourceId === 'pubmed') return `"${safe}"[Title/Abstract]`
    if (sourceId === 'europepmc') return `TITLE_ABS:"${safe}"`
    return value
  }

  return query
}

/**
 * @param {QueryAnalysis | null | undefined} analysis
 * @returns {boolean}
 */
export function isSequenceAnalysis(analysis) {
  return analysis?.kind === 'sequence'
}
