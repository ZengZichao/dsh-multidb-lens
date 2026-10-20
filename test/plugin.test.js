import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { access } from 'node:fs/promises'
import { apply, Config, name, ROUTES } from '../src/index.js'

const fileUrl = (path) => new URL(`../${path}`, import.meta.url)

async function read(path) {
  return readFile(fileUrl(path), 'utf8')
}

function fakeContext() {
  const registrations = []
  const disposed = []
  const logs = []
  const effects = []
  const ctx = {
    get(service) {
      if (service !== 'webServer') return undefined
      return {
        register(spec) {
          registrations.push(spec)
          return () => disposed.push(spec.path)
        },
      }
    },
    logger: {
      info: (line) => logs.push(String(line)),
      warn: (line) => logs.push(String(line)),
    },
    effect(fn) {
      const dispose = fn()
      effects.push(dispose)
      return dispose
    },
  }
  return { ctx, registrations, disposed, logs, effects }
}

test('host is a native Cordis plugin with name, Config and apply', () => {
  assert.equal(name, 'dsh-multidb-lens')
  assert.equal(typeof apply, 'function')
  const result = Config['~standard'].validate({ ncbiApiKey: 'k' })
  assert.deepEqual(result.value, { ncbiApiKey: 'k', ncbiEmail: '' })
})

test('apply registers both exact search routes and never logs the API key', () => {
  const { ctx, registrations, disposed, logs, effects } = fakeContext()
  apply(ctx, { ncbiApiKey: 'test-plugin-key' })

  assert.deepEqual(registrations.map((entry) => entry.path), ROUTES)
  assert.ok(registrations.every((entry) => entry.kind === 'exact'))
  assert.ok(registrations.every((entry) => typeof entry.handler === 'function'))
  assert.ok(logs.some((line) => line.includes('configured')))
  assert.equal(logs.some((line) => line.includes('test-plugin-key')), false)

  assert.equal(effects.length, 1)
  effects[0]()
  assert.deepEqual(disposed.sort(), [...ROUTES].sort())
})

test('manifest follows the dsh bundle + client contract', async () => {
  const pkg = JSON.parse(await read('package.json'))
  assert.equal(pkg.name, 'dsh-multidb-lens')
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.main, 'src/index.js')
  assert.equal(pkg.exports['./client'], './lib/client.js')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.equal(pkg.dsh.client.immediately, true)
  assert.equal(pkg.dependencies, undefined)
  assert.ok(pkg.files.includes('src/'))
  assert.ok(pkg.files.includes('lib/'))
  assert.ok(pkg.files.includes('locale/'))

  for (const path of ['src/index.js', 'lib/client.js', 'cordis.patch.yml', 'locale/zh.json', 'locale/en.json']) {
    await access(fileUrl(path))
  }
  const patch = await read('cordis.patch.yml')
  assert.match(patch, /id: dsh-multidb-lens/u)
  assert.match(patch, /name: dsh-multidb-lens/u)
})

test('host sources are dependency-free and API calls live on the host', async () => {
  const sources = await read('src/sources.js')
  assert.match(sources, /eutils\.ncbi\.nlm\.nih\.gov/u)
  assert.match(sources, /esearch\.fcgi/u)
  assert.match(sources, /esummary\.fcgi/u)
  assert.match(sources, /rest\.uniprot\.org\/uniprotkb\/search/u)
  assert.match(sources, /gtdb-api\.ecogenomic\.org/u)
  assert.match(sources, /bacdive\.dsmz\.de/u)
  assert.match(sources, /legatum\.arb-silva\.de/u)
  assert.match(sources, /lpsn\.dsmz\.de/u)
  assert.match(sources, /api\.seqco\.de|registry\.seqco\.de/u)
  assert.match(sources, /db:\s*'pubmed'/u)
  assert.match(sources, /europepmc\.org|ebi\.ac\.uk\/europepmc/u)
  assert.match(sources, /api\.openalex\.org/u)
  assert.match(sources, /format/u)
  assert.match(sources, /fields/u)
  assert.match(sources, /accession,protein_name,organism_name,cc_function/u)
  assert.match(await read('src/rate-limit.js'), /minIntervalMs \?\? 350/u)
  assert.match(await read('src/aggregate.js'), /Promise\.allSettled/u)
  assert.match(await read('src/analyze.js'), /buildSourceQuery/u)
  assert.match(await read('src/cache.js'), /createResultCache/u)

  const hostFiles = ['src/index.js', 'src/config.js', 'src/query.js', 'src/http.js', 'src/html.js', 'src/analyze.js', 'src/cache.js', 'src/rate-limit.js', 'src/sources.js', 'src/aggregate.js', 'src/route.js']
  for (const path of hostFiles) {
    const text = await read(path)
    assert.equal(/from\s+['"]@deepseek-ai\//u.test(text), false, `${path} must stay dependency-free`)
  }
})

test('client bundle enforces the selection, mode, sandbox and link contracts', async () => {
  const client = await read('lib/client.js')
  assert.ok(client.includes('全库搜索'))
  assert.ok(client.includes('单库搜索'))
  assert.ok(client.includes('单库检索结果'))
  assert.ok(client.includes('全库检索结果'))
  assert.ok(client.includes('智能检索词'))
  assert.ok(client.includes('BLAST 比对'))
  assert.ok(client.includes('复制 ID'))
  assert.ok(client.includes('复制引文'))
  assert.ok(client.includes('插入输入框'))
  assert.ok(client.includes('再显示'))
  for (const name of ['GTDB', 'BacDive', 'SILVA', 'LPSN', 'SeqCode', 'PubMed', 'Europe PMC', 'OpenAlex']) {
    assert.ok(client.includes(name), `${name} must be listed in the single-database submenu`)
  }
  assert.equal(client.includes('多库检索…'), false)
  assert.equal(client.includes('gtdb-api.ecogenomic.org'), false)
  assert.equal(client.includes('legatum.arb-silva.de'), false)
  assert.equal(client.includes('api.bacdive.dsmz.de'), false)
  assert.equal(client.includes('www.ebi.ac.uk'), false)
  assert.equal(client.includes('api.openalex.org'), false)
  assert.ok(client.includes('gtdb.ecogenomic.org'))
  assert.ok(client.includes('bacdive.dsmz.de'))
  assert.ok(client.includes('arb-silva.de'))
  assert.ok(client.includes('lpsn.dsmz.de'))
  assert.ok(client.includes('seqco.de'))
  assert.ok(client.includes('pubmed.ncbi.nlm.nih.gov'))
  assert.ok(client.includes('europepmc.org'))
  assert.ok(client.includes('doi.org'))
  assert.ok(client.includes('openalex.org'))
  assert.ok(client.includes('划词多库透镜'))
  assert.ok(client.includes("sandbox: 'allow-scripts'"))
  assert.equal(client.includes('allow-same-origin'), false)
  assert.equal(client.includes('allow-popups'), false)
  assert.equal(client.includes('allow-forms'), false)
  assert.equal(client.includes('allow-top-navigation'), false)
  assert.equal(client.includes('api_key'), false)
  assert.equal(client.includes('eutils.ncbi.nlm.nih.gov'), false)
  assert.equal(client.includes('rest.uniprot.org'), false)
  assert.ok(client.includes("window.open(url, '_blank', 'noopener,noreferrer')"))
  assert.ok(client.includes('Content-Security-Policy'))
  assert.ok(client.includes("connect-src 'none'"))
  assert.ok(client.includes('data-chat-flow'))
  assert.ok(client.includes('contextmenu'))
  assert.ok(client.includes('检索词已截断'))
  assert.ok(client.includes('该库查询失败'))
  assert.ok(client.includes('该库查询超时'))
})
