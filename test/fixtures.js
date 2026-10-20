/** Shared deterministic provider fakes for the test suite. */

export const TEST_ENDPOINTS = {
  ncbiBase: 'https://ncbi.test/eutils',
  uniprotSearch: 'https://uniprot.test/uniprotkb/search',
  gtdbSearch: 'https://gtdb.test/search/gtdb',
  bacdiveSearch: 'https://bacdive.test/search',
  silvaWs: 'https://silva.test/WS/',
  lpsnSearch: 'https://lpsn.test/search',
  seqcodeSearch: 'https://seqcode.test/search',
  europePmcSearch: 'https://europepmc.test/search',
  openAlexSearch: 'https://openalex.test/works',
}

export const noopLimiter = {
  schedule(task) {
    return task()
  },
}

export function jsonResponse(value, options = {}) {
  const status = options.status ?? 200
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json',
      ...options.headers,
    },
  })
}

export function textResponse(value, options = {}) {
  const status = options.status ?? 200
  return new Response(String(value), {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      ...options.headers,
    },
  })
}

export const DEFAULT_NCBI_SUMMARIES = {
  1: {
    uid: '1',
    accessionversion: 'NP_000001.1',
    title: 'Hemoglobin subunit alpha',
    organism: 'Homo sapiens',
    slen: 142,
  },
  2: {
    uid: '2',
    accessionversion: 'NP_000002.1',
    title: 'Hemoglobin subunit beta',
    organism: 'Homo sapiens',
    slen: 147,
  },
}

export const DEFAULT_UNIPROT_RESULTS = [
  {
    primaryAccession: 'P69905',
    proteinDescription: { recommendedName: { fullName: { value: 'Hemoglobin subunit alpha' } } },
    organism: { scientificName: 'Homo sapiens' },
    comments: [
      { commentType: 'FUNCTION', texts: [{ value: 'Involved in oxygen transport from the lung to tissues.' }] },
    ],
  },
  {
    primaryAccession: 'P68871',
    proteinDescription: { recommendedName: { fullName: { value: 'Hemoglobin subunit beta' } } },
    organism: { scientificName: 'Homo sapiens' },
    comments: [
      { commentType: 'FUNCTION', texts: [{ value: 'Involved in oxygen transport from the lung to tissues.' }] },
    ],
  },
]

export const DEFAULT_GTDB_ROWS = [
  {
    gid: 'GCA_000001.1',
    accession: 'GCA_000001.1',
    ncbiOrgName: 'Escherichia coli K-12',
    gtdbTaxonomy: 'd__Bacteria; p__Pseudomonadota; c__Gammaproteobacteria; o__Enterobacterales; f__Enterobacteriaceae; g__Escherichia; s__Escherichia coli',
    isGtdbSpeciesRep: true,
    isNcbiTypeMaterial: false,
  },
  {
    gid: 'GCA_000002.1',
    accession: 'GCA_000002.1',
    ncbiOrgName: 'Escherichia coli O157:H7',
    gtdbTaxonomy: 'd__Bacteria; p__Pseudomonadota; c__Gammaproteobacteria; o__Enterobacterales; f__Enterobacteriaceae; g__Escherichia; s__Escherichia coli',
    isGtdbSpeciesRep: false,
    isNcbiTypeMaterial: true,
  },
]

export const DEFAULT_PUBMED_SUMMARIES = {
  10944877: {
    uid: '10944877',
    pubdate: '2000 Jun',
    source: 'J R Soc Promot Health',
    authors: [{ name: 'Johnston M', authtype: 'Author' }],
    title: 'Escherichia coli--a review.',
    fulljournalname: 'The journal of the Royal Society for the Promotion of Health',
    pubtype: ['Journal Article', 'Review'],
  },
  12718050: {
    uid: '12718050',
    pubdate: '2003 Mar',
    source: 'Nihon Rinsho',
    authors: [{ name: 'Hayashi T', authtype: 'Author' }],
    title: '[Escherichia coli].',
    fulljournalname: 'Nihon rinsho. Japanese journal of clinical medicine',
    pubtype: ['Journal Article', 'Review'],
  },
}

export const EUROPEPMC_RESULTS = {
  hitCount: 2,
  resultList: {
    result: [
      {
        id: '39000001',
        source: 'MED',
        pmid: '39000001',
        doi: '10.1000/example',
        title: 'Escherichia coli in the mammalian gut',
        authorString: 'Smith J, Doe A, Roe B, Poe C.',
        journalTitle: 'Nature',
        pubYear: '2024',
        isOpenAccess: 'Y',
      },
      {
        id: 'PPR123',
        source: 'PPR',
        title: 'A preprint on Escherichia coli ecology',
        authorString: 'Lee K.',
        journalTitle: 'bioRxiv',
        pubYear: '2025',
        isOpenAccess: 'N',
      },
    ],
  },
}

export const OPENALEX_RESULTS = {
  meta: { count: 2 },
  results: [
    {
      id: 'https://openalex.org/W1',
      doi: 'https://doi.org/10.1038/nature123',
      title: 'Escherichia coli metabolism',
      publication_year: 2023,
      authorships: [
        { author: { display_name: 'Ada Lovelace' } },
        { author: { display_name: 'Alan Turing' } },
      ],
      primary_location: { source: { display_name: 'Nature' } },
      cited_by_count: 42,
    },
    {
      id: 'https://openalex.org/W2',
      doi: null,
      title: 'Unpublished Escherichia coli observations',
      publication_year: 2022,
      authorships: [],
      primary_location: null,
      cited_by_count: 0,
    },
  ],
}

export const BACDIVE_HTML = `
<div class="hits">hits: 2</div>
<ul class="searchresult advsearchresult">
  <li class="searchresultrow1 clearfix"><span>Select for download</span></li>
  <li class="searchresultrow1">
    <a href="/strain/4907" target="_self">Escherichia coli</a>
    <span>designation_header: U5/41</span>
    <span>strain number: DSM 30083 &amp; ATCC 11775</span>
    <span>type strain: <img src="images/haken.gif" alt="Yes" title="Yes" /></span>
  </li>
  <li class="searchresultrow2">
    <a href="/strain/4409" target="_self">Escherichia coli</a>
    <span>strain number: DSM 301, NCTC 86</span>
  </li>
</ul>`

export const SILVA_STATS = {
  searchStats: '<p class="statistic">rRNA regions: 1 - 25 / 3,412</p>',
}

export const SILVA_RESULT = {
  searchResult: `
    <table>
      <tr class="resultItem" sid="1">
        <td class="accessionNumber">A14565</td>
        <td class="organismName"><em>Escherichia coli</em></td>
        <td class="sequenceLength">1521</td>
        <td class="quality"><img alt="93.43%" /></td>
        <td class="quality"><img alt="99.00%" /></td>
        <td class="taxonomyPath"><span class="popup" popuptext="Bacteria<img alt=';' />Pseudomonadota<img alt=';' />Gammaproteobacteria<img alt=';' />Enterobacteriaceae">Bacteria...</span></td>
      </tr>
      <tr class="resultItem" sid="2">
        <td class="accessionNumber">A39827</td>
        <td class="organismName"><em>Escherichia coli</em></td>
        <td class="sequenceLength">903</td>
        <td class="quality"><img alt="90.77%" /></td>
        <td class="quality"><img alt="93.00%" /></td>
        <td class="taxonomyPath"><span class="popup" popuptext="Bacteria<img alt=';' />Pseudomonadota<img alt=';' />Gammaproteobacteria<img alt=';' />Enterobacterales">Bacteria...</span></td>
      </tr>
    </table>`,
}

export const LPSN_HTML = `
<h1>Search: Escherichia (2 results)</h1>
<ul>
  <li><a href="/species/escherichia-coli" class=" color-species"><STRONG><I>Escherichia</I> <I>coli</I></STRONG></a> <abbr title="validly published under the ICNP">&#129515;</abbr></li>
  <li><a href="/subspecies/escherichia-coli-shigellae" class=" color-subspecies">"<I>Escherichia</I> <I>coli</I> subsp. <I>shigellae</I>"</a> <abbr title="not validly published">&#129405;</abbr></li>
</ul>`

export const SEQCODE_HTML = `
<table>
  <tbody>
    <tr><th><a href="/names/7303"><i>Escherichia fergusonii</i></a></th><div>
      <td class=""><em>Unknown</em></td>
      <td class="">Valid (ICNP)</td>
      <td class="">Excubia bot</td>
    </div><td></td></tr>
    <tr><th><a href="/names/39292">&#8220;Escherichia alba&#8221;</a></th><div>
      <td class="">Speth et al., 2017</td>
      <td class="">Automated discovery</td>
      <td class="">Excubia bot</td>
    </div><td></td></tr>
  </tbody>
</table>`

export function ncbiFetch(options = {}) {
  const total = options.total ?? '2'
  const ids = options.ids ?? ['1', '2']
  const summaries = options.summaries ?? DEFAULT_NCBI_SUMMARIES
  const calls = []
  const fetchImpl = async (input) => {
    const url = new URL(String(input))
    calls.push(url)
    const db = url.searchParams.get('db')
    if (db === 'pubmed') {
      const pubmedIds = ['10944877', '12718050']
      if (url.pathname.endsWith('/esearch.fcgi')) {
        return jsonResponse({ esearchresult: { count: '2', idlist: pubmedIds } })
      }
      if (url.pathname.endsWith('/esummary.fcgi')) {
        return jsonResponse({ result: { uids: pubmedIds, ...DEFAULT_PUBMED_SUMMARIES } })
      }
    }
    if (url.pathname.endsWith('/esearch.fcgi')) {
      return jsonResponse({ esearchresult: { count: total, idlist: ids } })
    }
    if (url.pathname.endsWith('/esummary.fcgi')) {
      return jsonResponse({ result: { uids: ids, ...summaries } })
    }
    throw new Error(`unexpected NCBI URL: ${url}`)
  }
  return { fetchImpl, calls }
}

export function uniprotFetch(options = {}) {
  const results = options.results ?? DEFAULT_UNIPROT_RESULTS
  const total = options.total ?? '2'
  const calls = []
  const fetchImpl = async (input) => {
    const url = new URL(String(input))
    calls.push(url)
    if (!url.pathname.includes('/uniprotkb/search')) throw new Error(`unexpected UniProt URL: ${url}`)
    return jsonResponse({ results }, { headers: { 'x-total-results': total } })
  }
  return { fetchImpl, calls }
}

/** A fetch that never settles until aborted; used to exercise source timeouts. */
export function hangingFetch() {
  return async (_input, init) => new Promise((_resolve, reject) => {
    const signal = init?.signal
    const fail = () => {
      const error = new Error('aborted')
      error.name = 'AbortError'
      reject(error)
    }
    if (signal?.aborted) {
      fail()
      return
    }
    signal?.addEventListener('abort', fail, { once: true })
  })
}

export function failingFetch(status = 500, body = { error: 'provider down' }) {
  const calls = []
  const fetchImpl = async (input) => {
    calls.push(new URL(String(input)))
    return jsonResponse(body, { status })
  }
  return { fetchImpl, calls }
}

const NEW_SOURCE_HTML = {
  bacdive: BACDIVE_HTML,
  lpsn: LPSN_HTML,
  seqcode: SEQCODE_HTML,
}

/**
 * Combine provider behaviors for `searchAll` and route tests.
 * Every source accepts: 'ok' | 'fail' | 'hang' | 'invalid'.
 */
export function combinedFetch(behaviors = {}) {
  const ncbiBehavior = behaviors.ncbi ?? 'ok'
  const uniprotBehavior = behaviors.uniprot ?? 'ok'
  const ncbi = ncbiFetch(behaviors.ncbiOptions)
  const uniprot = uniprotFetch(behaviors.uniprotOptions)
  const calls = []

  const fetchImpl = async (input, init) => {
    const url = new URL(String(input))
    calls.push(url)
    const host = url.hostname
    const behavior = behaviors[host.split('.')[0]] ?? 'ok'
    const failure = behavior === 'fail'
      ? textResponse('provider down', { status: 500 })
      : behavior === 'hang'
        ? null
        : undefined
    if (failure === null) return hangingFetch()(input, init)
    if (failure !== undefined) return failure
    if (behavior === 'invalid' && host !== 'ncbi.test' && host !== 'uniprot.test') {
      return textResponse('not the expected document')
    }

    if (url.pathname.endsWith('/esearch.fcgi') || url.pathname.endsWith('/esummary.fcgi')) {
      if (ncbiBehavior === 'fail') return jsonResponse({ error: 'ncbi down' }, { status: 500 })
      if (ncbiBehavior === 'hang') return hangingFetch()(input, init)
      if (ncbiBehavior === 'invalid') {
        return new Response('not json', { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return ncbi.fetchImpl(input, init)
    }
    if (url.pathname.includes('/uniprotkb/search')) {
      if (uniprotBehavior === 'fail') return jsonResponse({ error: 'uniprot down' }, { status: 500 })
      if (uniprotBehavior === 'hang') return hangingFetch()(input, init)
      if (uniprotBehavior === 'invalid') {
        return jsonResponse({ notResults: true })
      }
      return uniprot.fetchImpl(input, init)
    }
    if (host === 'gtdb.test') {
      return jsonResponse({ rows: DEFAULT_GTDB_ROWS, totalRows: 2 })
    }
    if (host === 'silva.test') {
      const body = typeof init?.body === 'string' ? init.body : ''
      return jsonResponse(body.includes('action%5D=stats') || body.includes('action]=stats')
        ? SILVA_STATS
        : SILVA_RESULT)
    }
    if (host === 'bacdive.test' || host === 'lpsn.test' || host === 'seqcode.test') {
      return textResponse(NEW_SOURCE_HTML[host.split('.')[0]])
    }
    if (host === 'europepmc.test') return jsonResponse(EUROPEPMC_RESULTS)
    if (host === 'openalex.test') return jsonResponse(OPENALEX_RESULTS)
    throw new Error(`unexpected URL: ${url}`)
  }

  return { fetchImpl, calls }
}
