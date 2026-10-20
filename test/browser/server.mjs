import http from 'node:http'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const CLIENT_PATH = path.resolve(here, '../../lib/client.js')

function resolveReactFile(name) {
  const candidates = [
    process.env.REACT_UMD_DIR === undefined ? undefined : path.join(process.env.REACT_UMD_DIR, name),
    path.join(here, 'node_modules', name),
    path.resolve(here, '../../node_modules', name),
  ].filter((candidate) => typeof candidate === 'string')
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error(`React UMD build not found (${name}); install react/react-dom or set REACT_UMD_DIR`)
}

const REACT_PATH = resolveReactFile('react/umd/react.production.min.js')
const REACT_DOM_PATH = resolveReactFile('react-dom/umd/react-dom.production.min.js')
const LONG_TEXT = 'L'.repeat(260)

const HARNESS_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>dsh-multidb-lens harness</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f7f7f8; color: #222; }
  #layout { display: flex; min-height: 100vh; }
  #sidebar { width: 220px; padding: 20px; background: #ececf0; }
  #main { flex: 1; padding: 24px 40px; }
  #conversation { max-width: 760px; border: 1px solid #ddd; border-radius: 12px; background: white; padding: 20px; }
  #conversation p { padding: 10px 14px; margin: 0 0 12px; border-radius: 8px; background: #f5f5f7; }
  #conversation [data-chat-flow-kind="assistant"] p { background: #eef3ff; }
  #composer { margin-top: 20px; max-width: 760px; border: 1px solid #ccc; border-radius: 10px; padding: 12px; background: white; }
  #editor { min-height: 40px; outline: none; }
  #root { position: fixed; inset: 0; pointer-events: none; }
  #root > * { pointer-events: auto; }
</style>
</head>
<body>
<div id="layout">
  <aside id="sidebar"><h3>Sidebar</h3><p id="sidebar-text">P68871 outside conversation</p></aside>
  <main id="main">
    <h1>Harness session</h1>
    <div id="conversation" data-chat-flow="">
      <div data-chat-flow-kind="user"><p id="user-text">Please inspect TP53 and P68871.</p></div>
      <div data-chat-flow-kind="assistant">
        <p id="assistant-main">Hemoglobin subunit beta (P68871) transports oxygen.</p>
        <p id="assistant-microbe">Escherichia coli and Nitrososphaera viennensis are model microbes.</p>
        <p id="assistant-sequence">ACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGT</p>
        <p id="assistant-many">MANY records should paginate locally.</p>
        <p id="assistant-doi">10.1038/nature123</p>
        <p id="assistant-allok">ALL_OK P69905 and P68871 should both return.</p>
        <p id="assistant-slow">SLOW P68871 should time out.</p>
        <p id="assistant-ncbi-fail">NCBI_FAIL P68871 should keep UniProt.</p>
        <p id="assistant-long">${LONG_TEXT}</p>
      </div>
    </div>
    <div id="composer"><div id="editor" contenteditable="true">Type here</div></div>
  </main>
</div>
<div id="root"></div>
<script src="/react.js"></script>
<script src="/react-dom.js"></script>
<script>
  window.__errors = [];
  window.addEventListener('error', function (event) { window.__errors.push(String(event.error || event.message)); });
  window.addEventListener('unhandledrejection', function (event) { window.__errors.push(String(event.reason)); });
  window.__ModuleLoader__ = {
    load: function (definition) {
      var module = definition.factory(function (name) {
        if (name === 'react') return React;
        return {};
      });
      window.__plugin = module;
      window.__pluginId = definition.id;
    }
  };
</script>
<script src="/client.js"></script>
<script>
  (function () {
    var plugin = window.__plugin;
    if (!plugin) { window.__errors.push('plugin did not load'); return; }
    var slots = {
      inject: function (name, callback) { callback(); },
      register: function (spec, Component) {
        window.__slotSpec = spec;
        window.__component = Component;
        return function () {};
      }
    };
    var ctx = {
      get: function (name) { return name === 'slots' ? slots : undefined; },
      slots: slots,
      effect: function (fn) { return fn(); }
    };
    plugin.apply(ctx);
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(window.__component));
    setTimeout(function () { window.__ready = true; }, 120);
  })();
</script>
</body>
</html>`

export const SOURCE_META = [
  { id: 'ncbi', name: 'NCBI Protein', subtitle: 'NCBI E-utilities · protein', homepage: 'https://www.ncbi.nlm.nih.gov/protein/' },
  { id: 'uniprot', name: 'UniProtKB', subtitle: 'UniProt REST API', homepage: 'https://www.uniprot.org/uniprotkb' },
  { id: 'gtdb', name: 'GTDB', subtitle: '基因组分类数据库 · 细菌/古菌', homepage: 'https://gtdb.ecogenomic.org/' },
  { id: 'bacdive', name: 'BacDive', subtitle: 'DSMZ 菌株表型数据库', homepage: 'https://bacdive.dsmz.de/' },
  { id: 'silva', name: 'SILVA', subtitle: 'rRNA 参考序列 · SSU', homepage: 'https://www.arb-silva.de/' },
  { id: 'lpsn', name: 'LPSN', subtitle: '原核生物命名名录', homepage: 'https://lpsn.dsmz.de/' },
  { id: 'seqcode', name: 'SeqCode', subtitle: '未培养原核生物基因组命名', homepage: 'https://registry.seqco.de/' },
  { id: 'pubmed', name: 'PubMed', subtitle: '生物医学文献 · MEDLINE', homepage: 'https://pubmed.ncbi.nlm.nih.gov/' },
  { id: 'europepmc', name: 'Europe PMC', subtitle: '生命科学文献 · 预印本', homepage: 'https://europepmc.org/' },
  { id: 'openalex', name: 'OpenAlex', subtitle: '开放学术文献索引', homepage: 'https://openalex.org/' },
]

const ITEMS = {
  ncbi: [
    {
      id: 'NP_000001.1',
      title: 'Hemoglobin subunit alpha',
      description: 'Homo sapiens · 142 aa',
      url: 'https://www.ncbi.nlm.nih.gov/protein/NP_000001.1',
    },
    {
      id: 'NP_000002.1',
      title: 'Hemoglobin subunit beta',
      description: 'Homo sapiens · 147 aa',
      url: 'https://www.ncbi.nlm.nih.gov/protein/NP_000002.1',
    },
  ],
  uniprot: [
    {
      id: 'P69905',
      title: 'Hemoglobin subunit alpha',
      description: 'Homo sapiens · Involved in oxygen transport from the lung to tissues.',
      url: 'https://www.uniprot.org/uniprotkb/P69905/entry',
    },
    {
      id: 'P68871',
      title: 'Hemoglobin subunit beta',
      description: 'Homo sapiens · Involved in oxygen transport from the lung to tissues.',
      url: 'https://www.uniprot.org/uniprotkb/P68871/entry',
    },
  ],
  gtdb: [
    {
      id: 'GCA_000001.1',
      title: 'Escherichia coli K-12',
      description: 'Enterobacteriaceae › Escherichia › Escherichia coli · 种代表基因组',
      url: 'https://gtdb.ecogenomic.org/tree?r=s__Escherichia%20coli',
    },
    {
      id: 'GCA_000002.1',
      title: 'Escherichia coli O157:H7',
      description: 'Enterobacteriaceae › Escherichia › Escherichia coli',
      url: 'https://gtdb.ecogenomic.org/tree?r=s__Escherichia%20coli',
    },
  ],
  bacdive: [
    {
      id: 'BacDive 4907',
      title: 'Escherichia coli',
      description: '菌株号 DSM 30083, ATCC 11775 · 模式菌株',
      url: 'https://bacdive.dsmz.de/strain/4907',
    },
    {
      id: 'BacDive 4409',
      title: 'Escherichia coli',
      description: '菌株号 DSM 301, NCTC 86',
      url: 'https://bacdive.dsmz.de/strain/4409',
    },
  ],
  silva: [
    {
      id: 'A14565',
      title: 'Escherichia coli',
      description: 'Enterobacteriaceae · 1521 bp · 质量 93.43%/99.00%',
      url: 'https://www.arb-silva.de/browser/ssu-144/A14565',
    },
    {
      id: 'A39827',
      title: 'Escherichia coli',
      description: 'Enterobacteriaceae · 903 bp · 质量 90.77%/93.00%',
      url: 'https://www.arb-silva.de/browser/ssu-144/A39827',
    },
  ],
  lpsn: [
    {
      id: 'species',
      title: 'Escherichia coli',
      description: 'species · ICNP 有效发表',
      url: 'https://lpsn.dsmz.de/species/escherichia-coli',
    },
    {
      id: 'subspecies',
      title: '"Escherichia coli subsp. shigellae"',
      description: 'subspecies · 未有效发表',
      url: 'https://lpsn.dsmz.de/subspecies/escherichia-coli-shigellae',
    },
  ],
  seqcode: [
    {
      id: 'i:7303',
      title: 'Escherichia fergusonii',
      description: 'SeqCode Registry · Valid (ICNP)',
      url: 'https://seqco.de/i:7303',
    },
    {
      id: 'i:39292',
      title: '“Escherichia alba”',
      description: 'SeqCode Registry · Automated discovery',
      url: 'https://seqco.de/i:39292',
    },
  ],
  pubmed: [
    {
      id: '10944877',
      title: 'Escherichia coli--a review.',
      description: 'Johnston M · J R Soc Promot Health · 2000 · 综述',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10944877/',
    },
    {
      id: '12718050',
      title: '[Escherichia coli].',
      description: 'Hayashi T · Nihon Rinsho · 2003 · 综述',
      url: 'https://pubmed.ncbi.nlm.nih.gov/12718050/',
    },
  ],
  europepmc: [
    {
      id: 'PMID 39000001',
      title: 'Escherichia coli in the mammalian gut',
      description: 'Smith J, Doe A, Roe B, Poe C. · Nature · 2024 · 开放获取',
      url: 'https://europepmc.org/article/MED/39000001',
    },
    {
      id: 'PPR123',
      title: 'A preprint on Escherichia coli ecology',
      description: 'Lee K. · bioRxiv · 2025',
      url: 'https://europepmc.org/article/PPR/PPR123',
    },
  ],
  openalex: [
    {
      id: '10.1038/nature123',
      title: 'Escherichia coli metabolism',
      description: 'Ada Lovelace, Alan Turing · Nature · 2023 · 被引 42',
      url: 'https://doi.org/10.1038/nature123',
    },
    {
      id: 'W2',
      title: 'Unpublished Escherichia coli observations',
      description: '2022',
      url: 'https://openalex.org/W2',
    },
  ],
}

const NCBI_MANY_ITEMS = [
  ...ITEMS.ncbi,
  ...Array.from({ length: 5 }, (_value, index) => ({
    id: `NP_00001${index + 3}.1`,
    title: `Protein record ${index + 3}`,
    description: 'Homo sapiens · 100 aa',
    url: `https://www.ncbi.nlm.nih.gov/protein/NP_00001${index + 3}.1`,
  })),
]

const SOURCE_DELAYS = {
  ncbi: 700,
  gtdb: 850,
  bacdive: 950,
  silva: 1050,
  lpsn: 1150,
  seqcode: 1250,
  pubmed: 1350,
  europepmc: 1450,
  openalex: 1550,
  uniprot: 1800,
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sendNdjson(res, event) {
  if (res.writableEnded || res.destroyed) return false
  return res.write(`${JSON.stringify(event)}\n`)
}

export async function startHarness() {
  const state = { requests: [] }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(HARNESS_HTML)
      return
    }
    if (url.pathname === '/client.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      res.end(await readFile(CLIENT_PATH))
      return
    }
    if (url.pathname === '/react.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      res.end(await readFile(REACT_PATH))
      return
    }
    if (url.pathname === '/react-dom.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      res.end(await readFile(REACT_DOM_PATH))
      return
    }
    if (url.pathname === '/__state') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(state))
      return
    }
    if (url.pathname === '/plugins/dsh-multidb-lens/search' || url.pathname === '/api/multidb-lens/search') {
      const raw = await readBody(req)
      let query = ''
      let source = null
      let sources = null
      let adaptive = true
      try {
        const body = JSON.parse(raw)
        query = typeof body.query === 'string' ? body.query : ''
        source = typeof body.source === 'string' && body.source !== '' ? body.source : null
        sources = Array.isArray(body.sources) ? body.sources.filter((id) => typeof id === 'string') : null
        adaptive = body.adaptive !== false
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'bad json' }))
        return
      }
      const behavior = query.includes('ALL_OK')
        ? 'all-ok'
        : query.includes('NCBI_FAIL')
          ? 'ncbi-fail'
          : query.includes('GTDB_FAIL')
            ? 'gtdb-fail'
            : query.includes('MANY')
              ? 'many'
              : query.includes('SLOW')
                ? 'slow'
                : 'default'
      const mode = source === null ? 'all' : 'single'
      state.requests.push({
        query,
        source,
        sources,
        adaptive,
        mode,
        length: Array.from(query).length,
        behavior,
        at: Date.now(),
      })

      const selectedIds = source !== null
        ? [source]
        : (sources === null ? SOURCE_META.map((entry) => entry.id) : sources)
      const selected = selectedIds
        .map((id) => SOURCE_META.find((entry) => entry.id === id))
        .filter((entry) => entry !== undefined)
      const isDoi = /^10\.\d{4,9}\//u.test(query)
      const isSequence = /^[ACGTUN]{20,}$/iu.test(query.replace(/\s+/gu, ''))
      const analysis = isDoi
        ? { queryKind: 'doi', queryLabel: 'DOI', detectedValue: query, sequenceType: null }
        : isSequence
          ? { queryKind: 'sequence', queryLabel: '核酸序列', detectedValue: query, sequenceType: 'dna' }
          : { queryKind: 'text', queryLabel: '', detectedValue: query, sequenceType: null }
      res.writeHead(200, {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'cache-control': 'no-store',
        'x-accel-buffering': 'no',
        connection: 'keep-alive',
      })
      res.flushHeaders?.()
      sendNdjson(res, {
        type: 'meta',
        query,
        truncated: Array.from(query).length > 200,
        length: Array.from(query).length,
        mode,
        sourceId: source,
        sourceIds: selectedIds,
        adaptive,
        ...analysis,
        sources: selected,
      })

      const timers = []
      const delayed = (ms, fn) => {
        const timer = setTimeout(() => {
          if (!res.writableEnded && !res.destroyed) fn()
        }, ms)
        timers.push(timer)
      }

      const emitSource = (id, elapsedMs) => {
        if (id === 'ncbi' && behavior === 'ncbi-fail') {
          sendNdjson(res, { type: 'source', id, status: 'error', elapsedMs, error: { code: 'http_error', message: '该库查询失败', detail: 'HTTP 502' } })
          return
        }
        if (id === 'gtdb' && behavior === 'gtdb-fail') {
          sendNdjson(res, { type: 'source', id, status: 'error', elapsedMs, error: { code: 'http_error', message: '该库查询失败', detail: 'HTTP 502' } })
          return
        }
        if (id === 'uniprot' && behavior === 'default') {
          sendNdjson(res, { type: 'source', id, status: 'error', elapsedMs, error: { code: 'http_error', message: '该库查询失败', detail: 'HTTP 502' } })
          return
        }
        if (id === 'uniprot' && behavior === 'slow') {
          sendNdjson(res, { type: 'source', id, status: 'error', elapsedMs, error: { code: 'timeout', message: '该库查询超时', detail: '超过检索时限未返回' } })
          return
        }
        const items = behavior === 'many' && id === 'ncbi' ? NCBI_MANY_ITEMS : ITEMS[id]
        sendNdjson(res, { type: 'source', id, status: 'ok', elapsedMs, items, total: 339498 })
      }

      if (source === null) {
        for (const id of selectedIds) {
          delayed(SOURCE_DELAYS[id], () => emitSource(id, SOURCE_DELAYS[id]))
        }
        const doneDelay = Math.max(...selectedIds.map((id) => SOURCE_DELAYS[id]))
        delayed(doneDelay, () => {
          sendNdjson(res, { type: 'done', elapsedMs: doneDelay })
          if (!res.writableEnded) res.end()
        })
      } else {
        delayed(600, () => {
          emitSource(source, 600)
          sendNdjson(res, { type: 'done', elapsedMs: 600 })
          if (!res.writableEnded) res.end()
        })
      }

      res.on('close', () => {
        for (const timer of timers) clearTimeout(timer)
      })
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = server.address().port
  return {
    url: `http://127.0.0.1:${port}/`,
    state,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}
