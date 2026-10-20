import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { searchAll } from '../src/aggregate.js'
import { createResultCache } from '../src/cache.js'
import { combinedFetch, noopLimiter, TEST_ENDPOINTS } from './fixtures.js'

function options(behaviors, extra = {}) {
  const { fetchImpl } = combinedFetch(behaviors)
  return {
    fetchImpl,
    endpoints: TEST_ENDPOINTS,
    limiter: noopLimiter,
    limit: 2,
    sourceTimeoutMs: 120,
    ...extra,
  }
}

test('searchAll runs all ten registered sources by default', async () => {
  const results = await searchAll('TP53', options({}))
  assert.deepEqual(
    results.map((result) => result.id),
    ['ncbi', 'uniprot', 'gtdb', 'bacdive', 'silva', 'lpsn', 'seqcode', 'pubmed', 'europepmc', 'openalex'],
  )
  assert.ok(results.every((result) => result.status === 'ok'))
  assert.ok(results.every((result) => result.items.length === 2))
})

test('sourceIds narrows a run to one database and preserves registry order', async () => {
  const { fetchImpl, calls } = combinedFetch()
  const results = await searchAll('Escherichia coli', {
    fetchImpl,
    endpoints: TEST_ENDPOINTS,
    limiter: noopLimiter,
    limit: 2,
    sourceTimeoutMs: 120,
    sourceIds: ['gtdb'],
  })
  assert.equal(results.length, 1)
  assert.equal(results[0].id, 'gtdb')
  assert.equal(results[0].status, 'ok')
  assert.equal(results[0].items.length, 2)
  assert.ok(calls.every((url) => url.hostname === 'gtdb.test'))

  const two = await searchAll('TP53', options({}, { sourceIds: ['silva', 'ncbi'] }))
  assert.deepEqual(two.map((result) => result.id), ['ncbi', 'silva'])
})

test('one source failure does not discard the other result (allSettled)', async () => {
  const results = await searchAll('TP53', options({ ncbi: 'fail' }, { sourceIds: ['ncbi', 'uniprot'] }))
  const ncbi = results.find((result) => result.id === 'ncbi')
  const uniprot = results.find((result) => result.id === 'uniprot')
  assert.equal(ncbi.status, 'error')
  assert.equal(ncbi.error.message, '该库查询失败')
  assert.equal(ncbi.error.code, 'http_error')
  assert.equal(uniprot.status, 'ok')
  assert.equal(uniprot.items[0].id, 'P69905')
})

test('a hung source times out while the fast source is emitted first', async () => {
  const events = []
  const started = Date.now()
  const results = await searchAll('TP53', options({ uniprot: 'hang' }, {
    sourceIds: ['ncbi', 'uniprot'],
    onSourceSettled: (outcome) => events.push({ ...outcome, at: Date.now() - started }),
  }))
  const elapsed = Date.now() - started
  const ncbi = results.find((result) => result.id === 'ncbi')
  const uniprot = results.find((result) => result.id === 'uniprot')

  assert.equal(ncbi.status, 'ok')
  assert.equal(uniprot.status, 'error')
  assert.equal(uniprot.error.code, 'timeout')
  assert.equal(uniprot.error.message, '该库查询超时')
  assert.equal(events.length, 2)
  assert.equal(events[0].id, 'ncbi')
  assert.equal(events[0].status, 'ok')
  assert.equal(events[1].id, 'uniprot')
  assert.equal(events[1].status, 'error')
  assert.ok(events[1].at - events[0].at >= 60, `settle gap was ${events[1].at - events[0].at}ms`)
  assert.ok(elapsed >= 90 && elapsed < 1500, `elapsed was ${elapsed}ms`)
})

test('both sources timing out still settles the aggregate', async () => {
  const started = Date.now()
  const results = await searchAll('TP53', options({ ncbi: 'hang', uniprot: 'hang' }, { sourceIds: ['ncbi', 'uniprot'] }))
  const elapsed = Date.now() - started
  assert.equal(results.length, 2)
  assert.ok(results.every((result) => result.status === 'error'))
  assert.ok(results.every((result) => result.error.code === 'timeout'))
  assert.ok(elapsed >= 90 && elapsed < 1500, `elapsed was ${elapsed}ms`)
})

test('searchAll reuses cached successful source outcomes without another request', async () => {
  const cache = createResultCache()
  const { fetchImpl, calls } = combinedFetch()
  const options = {
    fetchImpl,
    endpoints: TEST_ENDPOINTS,
    limiter: noopLimiter,
    limit: 2,
    sourceTimeoutMs: 120,
    sourceIds: ['gtdb'],
    adaptive: true,
    cache,
  }
  const first = await searchAll('Escherichia coli', options)
  assert.equal(calls.length, 1)
  assert.equal(first[0].cached, undefined)

  const second = await searchAll('Escherichia coli', options)
  assert.equal(calls.length, 1)
  assert.equal(second[0].cached, true)
  assert.equal(second[0].elapsedMs, 0)
  assert.equal(second[0].items.length, 2)
})

test('aggregate source literally uses Promise.allSettled and not Promise.all', async () => {
  const source = await readFile(new URL('../src/aggregate.js', import.meta.url), 'utf8')
  assert.ok(source.includes('Promise.allSettled'))
  assert.equal(source.includes('Promise.all('), false)
})
