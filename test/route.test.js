import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createSearchHandler } from '../src/route.js'
import { combinedFetch, noopLimiter, TEST_ENDPOINTS } from './fixtures.js'

const API_KEY = 'test-route-key'

async function withServer(behaviors, fn, overrides = {}) {
  const { fetchImpl, calls } = combinedFetch(behaviors)
  const logs = []
  const handler = createSearchHandler({
    config: { ncbiApiKey: API_KEY, ncbiEmail: '' },
    searchOptions: {
      fetchImpl,
      endpoints: TEST_ENDPOINTS,
      limiter: noopLimiter,
      limit: 2,
      sourceTimeoutMs: 150,
      ...overrides,
    },
    logger: {
      info: (line) => logs.push(String(line)),
      warn: (line) => logs.push(String(line)),
    },
  })
  const server = http.createServer(handler)
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = server.address().port
  try {
    return await fn({ base: `http://127.0.0.1:${port}`, calls, logs })
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

async function readEvents(response) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const events = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      if (line.trim() !== '') events.push({ ...JSON.parse(line), receivedAt: Date.now() })
      newline = buffer.indexOf('\n')
    }
  }
  buffer += decoder.decode()
  if (buffer.trim() !== '') events.push({ ...JSON.parse(buffer), receivedAt: Date.now() })
  return events
}

function post(base, body, headers = {}) {
  return fetch(`${base}/plugins/dsh-multidb-lens/search`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'sec-fetch-site': 'same-origin',
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

test('route streams meta, independent source events and done', async () => {
  await withServer({ ncbi: 'fail' }, async ({ base, calls, logs }) => {
    const response = await post(base, { query: 'Hemoglobin   P68871' })
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type'), /x-ndjson/u)
    const events = await readEvents(response)

    assert.equal(events[0].type, 'meta')
    assert.equal(events[0].query, 'Hemoglobin P68871')
    assert.equal(events[0].truncated, false)
    assert.equal(events[0].mode, 'all')
    assert.equal(events[0].sourceId, null)
    assert.deepEqual(
      events[0].sources.map((source) => source.name),
      ['NCBI Protein', 'UniProtKB', 'GTDB', 'BacDive', 'SILVA', 'LPSN', 'SeqCode', 'PubMed', 'Europe PMC', 'OpenAlex'],
    )
    assert.equal(events.at(-1).type, 'done')

    const ncbi = events.find((event) => event.type === 'source' && event.id === 'ncbi')
    const uniprot = events.find((event) => event.type === 'source' && event.id === 'uniprot')
    assert.equal(ncbi.status, 'error')
    assert.equal(ncbi.error.message, '该库查询失败')
    assert.equal(uniprot.status, 'ok')
    assert.equal(uniprot.items.length, 2)

    const body = JSON.stringify(events)
    assert.equal(body.includes(API_KEY), false)
    assert.equal(logs.some((line) => line.includes(API_KEY)), false)
    // The key is host-side only, but it does reach the NCBI request URL.
    assert.ok(calls.some((url) => url.searchParams.get('api_key') === API_KEY))
  })
})

test('route runs only the requested database in single mode', async () => {
  await withServer({}, async ({ base, calls }) => {
    const response = await post(base, { query: 'Escherichia coli', source: 'gtdb' })
    assert.equal(response.status, 200)
    const events = await readEvents(response)
    const meta = events[0]
    assert.equal(meta.mode, 'single')
    assert.equal(meta.sourceId, 'gtdb')
    assert.deepEqual(meta.sources.map((source) => source.name), ['GTDB'])

    const sourceEvents = events.filter((event) => event.type === 'source')
    assert.equal(sourceEvents.length, 1)
    assert.equal(sourceEvents[0].id, 'gtdb')
    assert.equal(sourceEvents[0].status, 'ok')
    assert.ok(calls.every((url) => url.hostname === 'gtdb.test'))
  })
})

test('route runs a selected subset of sources for all-mode search', async () => {
  await withServer({}, async ({ base }) => {
    const response = await post(base, { query: 'Escherichia coli', sources: ['gtdb', 'pubmed'] })
    assert.equal(response.status, 200)
    const events = await readEvents(response)
    const meta = events[0]
    assert.equal(meta.mode, 'all')
    assert.equal(meta.sourceId, null)
    assert.deepEqual(meta.sourceIds, ['gtdb', 'pubmed'])
    assert.deepEqual(meta.sources.map((source) => source.name), ['GTDB', 'PubMed'])
    assert.deepEqual(
      events.filter((event) => event.type === 'source').map((event) => event.id).sort(),
      ['gtdb', 'pubmed'],
    )
  })
})

test('route reports smart detection and adapts the upstream query', async () => {
  await withServer({}, async ({ base, calls }) => {
    const response = await post(base, { query: '10.1038/nature123', source: 'pubmed' })
    const events = await readEvents(response)
    const meta = events[0]
    assert.equal(meta.adaptive, true)
    assert.equal(meta.queryKind, 'doi')
    assert.equal(meta.queryLabel, 'DOI')
    assert.equal(meta.detectedValue, '10.1038/nature123')
    const esearch = calls.find((url) => url.pathname.endsWith('/esearch.fcgi'))
    assert.equal(esearch.searchParams.get('term'), '"10.1038/nature123"[DOI]')
  })
})

test('route raw mode keeps the original query but still reports detection', async () => {
  await withServer({}, async ({ base, calls }) => {
    const response = await post(base, { query: '10.1038/nature123', source: 'pubmed', adaptive: false })
    const events = await readEvents(response)
    assert.equal(events[0].adaptive, false)
    assert.equal(events[0].queryKind, 'doi')
    const esearch = calls.find((url) => url.pathname.endsWith('/esearch.fcgi'))
    assert.equal(esearch.searchParams.get('term'), '10.1038/nature123')
  })
})

test('route serves a repeated single-source search from cache', async () => {
  await withServer({}, async ({ base, calls }) => {
    const first = await readEvents(await post(base, { query: 'Escherichia coli', source: 'gtdb' }))
    assert.equal(first.find((event) => event.type === 'source').cached, false)
    const requestCount = calls.length

    const second = await readEvents(await post(base, { query: 'Escherichia coli', source: 'gtdb' }))
    const cached = second.find((event) => event.type === 'source')
    assert.equal(cached.cached, true)
    assert.equal(cached.status, 'ok')
    assert.equal(calls.length, requestCount)
  })
})

test('a fast source event arrives before a slow source times out', async () => {
  await withServer({ uniprot: 'hang' }, async ({ base }) => {
    const response = await post(base, { query: 'P68871' })
    const events = await readEvents(response)
    const ncbi = events.find((event) => event.type === 'source' && event.id === 'ncbi')
    const uniprot = events.find((event) => event.type === 'source' && event.id === 'uniprot')
    assert.equal(ncbi.status, 'ok')
    assert.equal(uniprot.status, 'error')
    assert.equal(uniprot.error.code, 'timeout')
    assert.equal(uniprot.error.message, '该库查询超时')
    const gap = uniprot.receivedAt - ncbi.receivedAt
    assert.ok(gap >= 70, `stream gap was ${gap}ms`)
  })
})

test('route truncates overlong selections and reports the notice flag', async () => {
  await withServer({}, async ({ base }) => {
    const response = await post(base, { query: `  ${'A'.repeat(260)}  ` })
    const events = await readEvents(response)
    const meta = events[0]
    assert.equal(meta.type, 'meta')
    assert.equal(meta.truncated, true)
    assert.equal(Array.from(meta.query).length, 200)
    assert.equal(meta.length, 260)
  })
})

test('route rejects invalid requests without starting a stream', async () => {
  await withServer({}, async ({ base }) => {
    const empty = await post(base, { query: '  \n  ' })
    assert.equal(empty.status, 400)
    assert.equal((await empty.json()).ok, false)

    const wrongType = await post(base, { query: 42 })
    assert.equal(wrongType.status, 400)

    const tooLong = await post(base, { query: 'x'.repeat(4001) })
    assert.equal(tooLong.status, 413)

    const get = await fetch(`${base}/plugins/dsh-multidb-lens/search`)
    assert.equal(get.status, 405)

    const invalidJson = await fetch(`${base}/plugins/dsh-multidb-lens/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    })
    assert.equal(invalidJson.status, 400)

    const unknownSource = await post(base, { query: 'x', source: 'wormbase' })
    assert.equal(unknownSource.status, 400)
    assert.equal((await unknownSource.json()).error, '未知数据库')

    const unknownSubset = await post(base, { query: 'x', sources: ['gtdb', 'wormbase'] })
    assert.equal(unknownSubset.status, 400)
    assert.equal((await unknownSubset.json()).error, '未知数据库')

    const emptySubset = await post(base, { query: 'x', sources: [] })
    assert.equal(emptySubset.status, 400)

    const badAdaptive = await post(base, { query: 'x', adaptive: 'yes' })
    assert.equal(badAdaptive.status, 400)
  })
})

test('route refuses cross-site callers when Sec-Fetch-Site is present', async () => {
  await withServer({}, async ({ base }) => {
    const response = await post(base, { query: 'P68871' }, { 'sec-fetch-site': 'cross-site' })
    assert.equal(response.status, 403)
    assert.equal((await response.json()).ok, false)
  })
})
