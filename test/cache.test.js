import test from 'node:test'
import assert from 'node:assert/strict'
import { createResultCache } from '../src/cache.js'

test('cache returns successful outcomes until they expire', () => {
  let clock = 1000
  const cache = createResultCache({ ttlMs: 100, maxEntries: 4, now: () => clock })
  const outcome = { id: 'gtdb', status: 'ok', items: [{ id: 'G1' }], total: 1 }
  cache.set('gtdb', 'Escherichia coli', { adaptive: true, limit: 20 }, outcome)

  assert.deepEqual(cache.get('gtdb', 'Escherichia coli', { adaptive: true, limit: 20 }), {
    id: 'gtdb',
    status: 'ok',
    items: [{ id: 'G1' }],
    total: 1,
  })
  assert.equal(cache.get('gtdb', 'Escherichia coli', { adaptive: false, limit: 20 }), null)
  assert.equal(cache.get('gtdb', 'Escherichia coli', { adaptive: true, limit: 5 }), null)

  clock += 101
  assert.equal(cache.get('gtdb', 'Escherichia coli', { adaptive: true, limit: 20 }), null)
})

test('cache never stores failures and evicts the oldest entry', () => {
  const cache = createResultCache({ ttlMs: 1000, maxEntries: 2 })
  cache.set('ncbi', 'q1', { adaptive: true, limit: 20 }, { id: 'ncbi', status: 'error' })
  assert.equal(cache.size, 0)

  cache.set('a', 'q', { adaptive: true, limit: 20 }, { id: 'a', status: 'ok', items: [], total: 0 })
  cache.set('b', 'q', { adaptive: true, limit: 20 }, { id: 'b', status: 'ok', items: [], total: 0 })
  cache.get('a', 'q', { adaptive: true, limit: 20 })
  cache.set('c', 'q', { adaptive: true, limit: 20 }, { id: 'c', status: 'ok', items: [], total: 0 })

  assert.ok(cache.get('a', 'q', { adaptive: true, limit: 20 }))
  assert.ok(cache.get('c', 'q', { adaptive: true, limit: 20 }))
  assert.equal(cache.get('b', 'q', { adaptive: true, limit: 20 }), null)
})
