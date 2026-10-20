import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeQuery } from '../src/analyze.js'
import {
  searchBacDive,
  searchEuropePmc,
  searchGtdb,
  searchLpsn,
  searchNcbi,
  searchOpenAlex,
  searchPubMed,
  searchSeqCode,
  searchSilva,
  searchUniProt,
} from '../src/sources.js'
import {
  combinedFetch,
  ncbiFetch,
  noopLimiter,
  TEST_ENDPOINTS,
  uniprotFetch,
} from './fixtures.js'

test('NCBI runs esearch then batch esummary and maps card fields', async () => {
  const { fetchImpl, calls } = ncbiFetch()
  const result = await searchNcbi('hemoglobin', {
    fetchImpl,
    endpoints: TEST_ENDPOINTS,
    limiter: noopLimiter,
    limit: 2,
    ncbiApiKey: 'test-api-key',
    ncbiEmail: 'lens@example.test',
  })

  assert.equal(calls.length, 2)
  assert.equal(calls[0].pathname, '/eutils/esearch.fcgi')
  assert.equal(calls[0].searchParams.get('db'), 'protein')
  assert.equal(calls[0].searchParams.get('term'), 'hemoglobin')
  assert.equal(calls[0].searchParams.get('retmax'), '2')
  assert.equal(calls[0].searchParams.get('sort'), 'relevance')
  assert.equal(calls[0].searchParams.get('tool'), 'dsh-multidb-lens')
  assert.equal(calls[0].searchParams.get('api_key'), 'test-api-key')
  assert.equal(calls[0].searchParams.get('email'), 'lens@example.test')

  assert.equal(calls[1].pathname, '/eutils/esummary.fcgi')
  assert.equal(calls[1].searchParams.get('id'), '1,2')

  assert.equal(result.total, 2)
  assert.equal(result.items.length, 2)
  assert.deepEqual(result.items[0], {
    id: 'NP_000001.1',
    title: 'Hemoglobin subunit alpha',
    description: 'Homo sapiens · 142 aa',
    url: 'https://www.ncbi.nlm.nih.gov/protein/NP_000001.1',
  })
  assert.equal(JSON.stringify(result).includes('test-api-key'), false)
})

test('NCBI returns an empty page without calling esummary', async () => {
  const { fetchImpl, calls } = ncbiFetch({ ids: [], total: '0' })
  const result = await searchNcbi('no hits', {
    fetchImpl,
    endpoints: TEST_ENDPOINTS,
    limiter: noopLimiter,
  })
  assert.equal(calls.length, 1)
  assert.deepEqual(result, { items: [], total: 0 })
})

test('NCBI surfaces an HTTP failure as a structured error', async () => {
  const { fetchImpl } = combinedFetch({ ncbi: 'fail' })
  await assert.rejects(
    searchNcbi('x', { fetchImpl, endpoints: TEST_ENDPOINTS, limiter: noopLimiter }),
    (error) => {
      assert.equal(error.code, 'http_error')
      assert.equal(error.status, 500)
      return true
    },
  )
})

test('NCBI surfaces malformed JSON as invalid_response', async () => {
  const { fetchImpl } = combinedFetch({ ncbi: 'invalid' })
  await assert.rejects(
    searchNcbi('x', { fetchImpl, endpoints: TEST_ENDPOINTS, limiter: noopLimiter }),
    (error) => {
      assert.equal(error.code, 'invalid_response')
      return true
    },
  )
})

test('UniProt uses compact fields and maps the first FUNCTION sentence', async () => {
  const { fetchImpl, calls } = uniprotFetch()
  const result = await searchUniProt('hemoglobin', {
    fetchImpl,
    endpoints: TEST_ENDPOINTS,
    limit: 2,
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].searchParams.get('query'), 'hemoglobin')
  assert.equal(calls[0].searchParams.get('format'), 'json')
  assert.equal(calls[0].searchParams.get('size'), '2')
  assert.equal(
    calls[0].searchParams.get('fields'),
    'accession,protein_name,organism_name,cc_function',
  )
  assert.equal(result.total, 2)
  assert.deepEqual(result.items[0], {
    id: 'P69905',
    title: 'Hemoglobin subunit alpha',
    description: 'Homo sapiens · Involved in oxygen transport from the lung to tissues.',
    url: 'https://www.uniprot.org/uniprotkb/P69905/entry',
  })
})

test('UniProt surfaces a missing results array as invalid_response', async () => {
  const { fetchImpl } = combinedFetch({ uniprot: 'invalid' })
  await assert.rejects(
    searchUniProt('x', { fetchImpl, endpoints: TEST_ENDPOINTS }),
    (error) => {
      assert.equal(error.code, 'invalid_response')
      return true
    },
  )
})

test('GTDB maps genome rows, lineage and species flags', async () => {
  const { fetchImpl, calls } = combinedFetch()
  const result = await searchGtdb('Escherichia coli', {
    fetchImpl,
    endpoints: TEST_ENDPOINTS,
    limit: 2,
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].pathname, '/search/gtdb')
  assert.equal(calls[0].searchParams.get('search'), 'Escherichia coli')
  assert.equal(calls[0].searchParams.get('itemsPerPage'), '2')
  assert.equal(result.total, 2)
  assert.deepEqual(result.items[0], {
    id: 'GCA_000001.1',
    title: 'Escherichia coli K-12',
    description: 'Enterobacteriaceae › Escherichia › Escherichia coli · 种代表基因组',
    url: 'https://gtdb.ecogenomic.org/tree?r=s__Escherichia%20coli',
  })
  assert.ok(result.items[1].description.includes('NCBI 模式菌株'))
})

test('BacDive parses strain rows, decodes entities and marks type strains', async () => {
  const { fetchImpl, calls } = combinedFetch()
  const result = await searchBacDive('Escherichia coli', {
    fetchImpl,
    endpoints: TEST_ENDPOINTS,
    limit: 2,
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].searchParams.get('search'), 'Escherichia coli')
  assert.equal(result.total, 2)
  assert.deepEqual(result.items[0], {
    id: 'BacDive 4907',
    title: 'Escherichia coli',
    description: '菌株号 DSM 30083 & ATCC 11775 · 模式菌株',
    url: 'https://bacdive.dsmz.de/strain/4907',
  })
  assert.equal(result.items[1].id, 'BacDive 4409')
})

test('SILVA combines the stats and result calls into cards', async () => {
  const { fetchImpl, calls } = combinedFetch()
  const result = await searchSilva('Escherichia coli', {
    fetchImpl,
    endpoints: TEST_ENDPOINTS,
    limit: 2,
  })

  assert.equal(calls.length, 2)
  assert.ok(calls.every((url) => url.hostname === 'silva.test'))
  assert.equal(result.total, 3412)
  assert.deepEqual(result.items[0], {
    id: 'A14565',
    title: 'Escherichia coli',
    description: 'Pseudomonadota › Gammaproteobacteria › Enterobacteriaceae · 1521 bp · 质量 93.43%/99.00%',
    url: 'https://www.arb-silva.de/browser/ssu-144/A14565',
  })
})

test('LPSN parses rank, name, status and quote spacing', async () => {
  const { fetchImpl, calls } = combinedFetch()
  const result = await searchLpsn('Escherichia coli', {
    fetchImpl,
    endpoints: TEST_ENDPOINTS,
    limit: 2,
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].searchParams.get('word'), 'Escherichia coli')
  assert.equal(result.total, 2)
  assert.deepEqual(result.items[0], {
    id: 'species',
    title: 'Escherichia coli',
    description: 'species · ICNP 有效发表',
    url: 'https://lpsn.dsmz.de/species/escherichia-coli',
  })
  assert.equal(result.items[1].title, '"Escherichia coli subsp. shigellae"')
  assert.ok(result.items[1].description.includes('未有效发表'))
})

test('adapters apply the detected entity syntax instead of the raw text', async () => {
  const { fetchImpl, calls } = combinedFetch()

  await searchPubMed('10.1038/nature123', {
    fetchImpl,
    endpoints: TEST_ENDPOINTS,
    limiter: noopLimiter,
    limit: 2,
    analysis: analyzeQuery('10.1038/nature123'),
  })
  assert.equal(calls[0].searchParams.get('term'), '"10.1038/nature123"[DOI]')

  await searchEuropePmc('PMID: 39000001', {
    fetchImpl,
    endpoints: TEST_ENDPOINTS,
    limit: 2,
    analysis: analyzeQuery('PMID: 39000001'),
  })
  assert.equal(calls.at(-1).searchParams.get('query'), 'EXT_ID:39000001')

  await searchUniProt('Escherichia coli', {
    fetchImpl,
    endpoints: TEST_ENDPOINTS,
    limit: 2,
    analysis: analyzeQuery('Escherichia coli'),
  })
  assert.equal(calls.at(-1).searchParams.get('query'), 'organism_name:"Escherichia coli"')

  await searchOpenAlex('10.1038/nature123', {
    fetchImpl,
    endpoints: TEST_ENDPOINTS,
    limit: 2,
    analysis: analyzeQuery('10.1038/nature123'),
  })
  assert.equal(calls.at(-1).searchParams.get('filter'), 'doi:10.1038/nature123')
  assert.equal(calls.at(-1).searchParams.get('search'), null)
})

test('PubMed runs esearch/esummary and maps authors, journal and review flag', async () => {
  const { fetchImpl, calls } = combinedFetch()
  const result = await searchPubMed('Escherichia coli', {
    fetchImpl,
    endpoints: TEST_ENDPOINTS,
    limiter: noopLimiter,
    limit: 2,
    ncbiApiKey: 'test-api-key',
    ncbiEmail: 'lens@example.test',
  })

  assert.equal(calls.length, 2)
  assert.equal(calls[0].pathname, '/eutils/esearch.fcgi')
  assert.equal(calls[0].searchParams.get('db'), 'pubmed')
  assert.equal(calls[0].searchParams.get('term'), 'Escherichia coli')
  assert.equal(calls[0].searchParams.get('api_key'), 'test-api-key')
  assert.equal(calls[0].searchParams.get('email'), 'lens@example.test')
  assert.equal(calls[1].searchParams.get('db'), 'pubmed')
  assert.equal(calls[1].searchParams.get('api_key'), 'test-api-key')
  assert.equal(result.total, 2)
  assert.equal(JSON.stringify(result).includes('test-api-key'), false)
  assert.deepEqual(result.items[0], {
    id: '10944877',
    title: 'Escherichia coli--a review.',
    description: 'Johnston M · J R Soc Promot Health · 2000 · 综述',
    url: 'https://pubmed.ncbi.nlm.nih.gov/10944877/',
  })
})

test('Europe PMC maps PubMed records and preprints', async () => {
  const { fetchImpl, calls } = combinedFetch()
  const result = await searchEuropePmc('Escherichia coli', {
    fetchImpl,
    endpoints: TEST_ENDPOINTS,
    limit: 2,
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].searchParams.get('query'), 'Escherichia coli')
  assert.equal(calls[0].searchParams.get('resultType'), 'lite')
  assert.equal(result.total, 2)
  assert.deepEqual(result.items[0], {
    id: 'PMID 39000001',
    title: 'Escherichia coli in the mammalian gut',
    description: 'Smith J, Doe A, Roe B, Poe C. · Nature · 2024 · 开放获取',
    url: 'https://europepmc.org/article/MED/39000001',
  })
  assert.equal(result.items[1].url, 'https://europepmc.org/article/PPR/PPR123')
})

test('OpenAlex maps DOI and non-DOI works', async () => {
  const { fetchImpl, calls } = combinedFetch()
  const result = await searchOpenAlex('Escherichia coli', {
    fetchImpl,
    endpoints: TEST_ENDPOINTS,
    limit: 2,
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].searchParams.get('search'), 'Escherichia coli')
  assert.equal(calls[0].searchParams.get('per-page'), '2')
  assert.equal(result.total, 2)
  assert.deepEqual(result.items[0], {
    id: '10.1038/nature123',
    title: 'Escherichia coli metabolism',
    description: 'Ada Lovelace, Alan Turing · Nature · 2023 · 被引 42',
    url: 'https://doi.org/10.1038/nature123',
  })
  assert.equal(result.items[1].url, 'https://openalex.org/W2')
})

test('SeqCode parses name rows and registry status', async () => {
  const { fetchImpl, calls } = combinedFetch()
  const result = await searchSeqCode('Escherichia', {
    fetchImpl,
    endpoints: TEST_ENDPOINTS,
    limit: 2,
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].searchParams.get('q'), 'Escherichia')
  assert.equal(calls[0].searchParams.get('what'), 'names')
  assert.equal(result.total, null)
  assert.deepEqual(result.items[0], {
    id: 'i:7303',
    title: 'Escherichia fergusonii',
    description: 'SeqCode Registry · Valid (ICNP)',
    url: 'https://seqco.de/i:7303',
  })
  assert.equal(result.items[1].title, '“Escherichia alba”')
  assert.ok(result.items[1].description.includes('Automated discovery'))
})
