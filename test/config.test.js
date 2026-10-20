import test from 'node:test'
import assert from 'node:assert/strict'
import { Config, resolveConfig, scrubSecret } from '../src/config.js'

test('Config accepts missing values and normalizes strings', () => {
  assert.deepEqual(Config['~standard'].validate(undefined), {
    value: { ncbiApiKey: '', ncbiEmail: '' },
  })
  assert.deepEqual(Config['~standard'].validate({ ncbiApiKey: '  key  ', ncbiEmail: ' a@b.c ' }), {
    value: { ncbiApiKey: 'key', ncbiEmail: 'a@b.c' },
  })
})

test('Config rejects non-object and non-string values', () => {
  assert.ok(Config['~standard'].validate('nope').issues)
  assert.ok(Config['~standard'].validate({ ncbiApiKey: 42 }).issues)
  assert.ok(Config['~standard'].validate({ ncbiEmail: 42 }).issues)
})

test('resolveConfig precedence is plugin config, DSH env, NCBI env', () => {
  const env = {
    DSH_MULTIDB_LENS_NCBI_API_KEY: 'dsh-env',
    NCBI_API_KEY: 'generic-env',
    DSH_MULTIDB_LENS_NCBI_EMAIL: 'dsh@example.test',
    NCBI_EMAIL: 'generic@example.test',
  }
  assert.deepEqual(resolveConfig({ ncbiApiKey: 'config' }, env), {
    ncbiApiKey: 'config',
    ncbiEmail: 'dsh@example.test',
  })
  assert.deepEqual(resolveConfig({}, env), {
    ncbiApiKey: 'dsh-env',
    ncbiEmail: 'dsh@example.test',
  })
  assert.deepEqual(resolveConfig({}, { NCBI_API_KEY: 'generic-env' }), {
    ncbiApiKey: 'generic-env',
    ncbiEmail: '',
  })
})

test('scrubSecret removes raw and encoded API keys', () => {
  const key = 'a+b/c=d'
  const raw = `x api_key=${key}&y`
  assert.equal(scrubSecret(raw, key).includes(key), false)
  assert.equal(scrubSecret(raw, key).includes('api_key=[redacted]'), true)
  assert.equal(scrubSecret(`api_key=${encodeURIComponent(key)}`, key).includes('%2B'), false)
})
