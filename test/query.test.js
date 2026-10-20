import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_QUERY_CHARS, normalizeSelection } from '../src/query.js'

test('normalizeSelection trims and collapses all whitespace runs', () => {
  assert.deepEqual(normalizeSelection('  TP53\n\n  tumor   protein \t '), {
    query: 'TP53 tumor protein',
    truncated: false,
    length: 18,
  })
})

test('empty and whitespace-only selections normalize to an empty query', () => {
  assert.deepEqual(normalizeSelection(''), { query: '', truncated: false, length: 0 })
  assert.deepEqual(normalizeSelection(' \n\t  '), { query: '', truncated: false, length: 0 })
  assert.deepEqual(normalizeSelection(null), { query: '', truncated: false, length: 0 })
})

test('exactly 200 code points are kept without truncation', () => {
  const value = 'a'.repeat(MAX_QUERY_CHARS)
  const normalized = normalizeSelection(value)
  assert.equal(normalized.query, value)
  assert.equal(normalized.truncated, false)
  assert.equal(normalized.length, MAX_QUERY_CHARS)
})

test('long selections are truncated to the first 200 code points', () => {
  const value = `  ${'x'.repeat(150)}\n${'y'.repeat(100)}  `
  const normalized = normalizeSelection(value)
  assert.equal(normalized.truncated, true)
  assert.equal(Array.from(normalized.query).length, MAX_QUERY_CHARS)
  assert.equal(normalized.query, `${'x'.repeat(150)} ${'y'.repeat(49)}`)
  assert.equal(normalized.length, 251)
})

test('truncation does not split surrogate pairs', () => {
  const value = '🧬'.repeat(201)
  const normalized = normalizeSelection(value)
  assert.equal(normalized.truncated, true)
  assert.equal(Array.from(normalized.query).length, MAX_QUERY_CHARS)
  assert.equal(normalized.query.endsWith('🧬'), true)
})
