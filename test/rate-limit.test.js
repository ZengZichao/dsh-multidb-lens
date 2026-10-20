import test from 'node:test'
import assert from 'node:assert/strict'
import { createSerialRateLimiter } from '../src/rate-limit.js'

test('the limiter serializes tasks and spaces their starts', async () => {
  const limiter = createSerialRateLimiter({ minIntervalMs: 40 })
  const starts = []
  const results = await Promise.all([1, 2, 3].map((id) => limiter.schedule(async () => {
    starts.push(Date.now())
    return id
  })))
  assert.deepEqual(results, [1, 2, 3])
  assert.equal(starts.length, 3)
  assert.ok(starts[1] - starts[0] >= 32, `gap 1 was ${starts[1] - starts[0]}ms`)
  assert.ok(starts[2] - starts[1] >= 32, `gap 2 was ${starts[2] - starts[1]}ms`)
})

test('a failed task does not poison the queue', async () => {
  const limiter = createSerialRateLimiter({ minIntervalMs: 5 })
  await assert.rejects(limiter.schedule(async () => {
    throw new Error('boom')
  }), /boom/u)
  assert.equal(await limiter.schedule(async () => 'after'), 'after')
})

test('aborting a queued task prevents it from running', async () => {
  const limiter = createSerialRateLimiter({ minIntervalMs: 80 })
  const first = limiter.schedule(async () => 'first')
  let ran = false
  const controller = new AbortController()
  const second = limiter.schedule(async () => {
    ran = true
    return 'second'
  }, controller.signal)
  setTimeout(() => controller.abort(), 10)
  assert.equal(await first, 'first')
  await assert.rejects(second, /abort/iu)
  assert.equal(ran, false)
})
