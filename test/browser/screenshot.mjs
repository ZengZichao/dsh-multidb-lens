/**
 * Regenerate the documentation screenshots with clean demo content.
 *
 * Usage:
 *   cd test/browser
 *   npm install
 *   CHROME_PATH=/path/to/chrome node screenshot.mjs
 *
 * The normal acceptance harness intentionally uses ALL_CAPS trigger strings and
 * a 260-character "L" selection to exercise failure and truncation paths. Those
 * strings are not suitable for public screenshots, so this script replaces the
 * conversation and mocks the search route with realistic E. coli data.
 */
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { SOURCE_META, startHarness } from './server.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const docs = path.resolve(here, '../../docs')
await mkdir(docs, { recursive: true })

const TOTALS = {
  ncbi: 12345,
  uniprot: 69248,
  gtdb: 52673,
  bacdive: 2133,
  silva: 382961,
  lpsn: 24,
  seqcode: 18,
  pubmed: 470188,
  europepmc: 1024753,
  openalex: 1651620,
}

const ITEMS = {
  ncbi: [
    ['NP_416895.1', 'DNA gyrase subunit A', 'Escherichia coli K-12 · 875 aa', 'https://www.ncbi.nlm.nih.gov/protein/NP_416895.1'],
    ['NP_418573.1', 'Outer membrane protein A', 'Escherichia coli K-12 · 346 aa', 'https://www.ncbi.nlm.nih.gov/protein/NP_418573.1'],
    ['NP_417879.1', 'Beta-galactosidase', 'Escherichia coli K-12 · 1024 aa', 'https://www.ncbi.nlm.nih.gov/protein/NP_417879.1'],
    ['NP_415256.1', 'Alkaline phosphatase', 'Escherichia coli K-12 · 471 aa', 'https://www.ncbi.nlm.nih.gov/protein/NP_415256.1'],
    ['NP_414548.1', 'Chaperone protein DnaK', 'Escherichia coli K-12 · 638 aa', 'https://www.ncbi.nlm.nih.gov/protein/NP_414548.1'],
  ],
  uniprot: [
    ['P0A7V8', 'DNA gyrase subunit A', 'Escherichia coli (strain K12) · ATP-dependent breakage and rejoining of DNA', 'https://www.uniprot.org/uniprotkb/P0A7V8/entry'],
    ['P0A910', 'Outer membrane protein A', 'Escherichia coli (strain K12) · Porin and structural outer membrane protein', 'https://www.uniprot.org/uniprotkb/P0A910/entry'],
    ['P00722', 'Beta-galactosidase', 'Escherichia coli (strain K12) · Hydrolysis of terminal beta-D-galactosides', 'https://www.uniprot.org/uniprotkb/P00722/entry'],
    ['P00634', 'Alkaline phosphatase', 'Escherichia coli (strain K12) · Nonspecific phosphomonoesterase', 'https://www.uniprot.org/uniprotkb/P00634/entry'],
    ['P0A6Y8', 'Chaperone protein DnaK', 'Escherichia coli (strain K12) · Heat-shock protein 70 family chaperone', 'https://www.uniprot.org/uniprotkb/P0A6Y8/entry'],
  ],
  gtdb: [
    ['GCA_000005845.2', 'Escherichia coli K-12', 'Enterobacteriaceae › Escherichia › Escherichia coli · 种代表基因组', 'https://gtdb.ecogenomic.org/tree?r=s__Escherichia%20coli'],
    ['GCA_000008865.2', 'Escherichia coli O157:H7 Sakai', 'Enterobacteriaceae › Escherichia › Escherichia coli', 'https://gtdb.ecogenomic.org/tree?r=s__Escherichia%20coli'],
    ['GCA_000013305.1', 'Escherichia coli CFT073', 'Enterobacteriaceae › Escherichia › Escherichia coli', 'https://gtdb.ecogenomic.org/tree?r=s__Escherichia%20coli'],
    ['GCA_000026545.1', 'Escherichia coli BL21(DE3)', 'Enterobacteriaceae › Escherichia › Escherichia coli', 'https://gtdb.ecogenomic.org/tree?r=s__Escherichia%20coli'],
    ['GCA_000210475.1', 'Escherichia coli HMS174(DE3)', 'Enterobacteriaceae › Escherichia › Escherichia coli', 'https://gtdb.ecogenomic.org/tree?r=s__Escherichia%20coli'],
  ],
  bacdive: [
    ['BacDive 4907', 'Escherichia coli', '菌株号 DSM 30083, ATCC 11775 · 模式菌株', 'https://bacdive.dsmz.de/strain/4907'],
    ['BacDive 4409', 'Escherichia coli', '菌株号 DSM 301, NCTC 86', 'https://bacdive.dsmz.de/strain/4409'],
    ['BacDive 4410', 'Escherichia coli', '菌株号 DSM 308, IMG 1728', 'https://bacdive.dsmz.de/strain/4410'],
    ['BacDive 4411', 'Escherichia coli', '菌株号 DSM 309, NCIB 8666', 'https://bacdive.dsmz.de/strain/4411'],
    ['BacDive 4932', 'Escherichia albertii', '菌株号 DSM 17582, CCUG 46494 · 模式菌株', 'https://bacdive.dsmz.de/strain/4932'],
  ],
  silva: [
    ['A14565', 'Escherichia coli', 'Enterobacterales › Enterobacteriaceae › Escherichia-Shigella · 1521 bp · 质量 93.43%/99.00%', 'https://www.arb-silva.de/browser/ssu-144/A14565'],
    ['X80733', 'Escherichia', 'Enterobacterales › Enterobacteriaceae › Escherichia-Shigella · 1447 bp · 质量 87.33%/100.00%', 'https://www.arb-silva.de/browser/ssu-144/X80733'],
    ['MK734184', 'Escherichia alba', 'Enterobacterales › Enterobacteriaceae › Escherichia-Shigella · 1411 bp · 质量 92.91%/99.00%', 'https://www.arb-silva.de/browser/ssu-144/MK734184'],
    ['A39827', 'Escherichia coli', 'Enterobacterales › Enterobacteriaceae › Escherichia-Shigella · 903 bp · 质量 90.77%/93.00%', 'https://www.arb-silva.de/browser/ssu-144/A39827'],
    ['AAADRG010000054', 'Escherichia albertii', 'Enterobacterales › Enterobacteriaceae › Escherichia-Shigella · 633 bp · 质量 89.47%/100.00%', 'https://www.arb-silva.de/browser/ssu-144/AAADRG010000054'],
  ],
  lpsn: [
    ['species', 'Escherichia coli', 'species · ICNP 有效发表', 'https://lpsn.dsmz.de/species/escherichia-coli'],
    ['genus', 'Escherichia', 'genus · ICNP 有效发表（保留名称）', 'https://lpsn.dsmz.de/genus/escherichia'],
    ['family', 'Escherichiaceae', 'family · ICNP 有效发表（非法名称）', 'https://lpsn.dsmz.de/family/escherichiaceae'],
    ['subspecies', 'Escherichia coli subsp. shigellae', 'subspecies · 未有效发表', 'https://lpsn.dsmz.de/subspecies/escherichia-coli-shigellae'],
    ['variety', 'Escherichia coli var. communis', 'variety · 未有效发表', 'https://lpsn.dsmz.de/variety/escherichia-coli-communis'],
  ],
  seqcode: [
    ['i:7303', 'Escherichia fergusonii', 'SeqCode Registry · Valid (ICNP)', 'https://seqco.de/i:7303'],
    ['i:39292', '“Escherichia alba”', 'SeqCode Registry · Automated discovery', 'https://seqco.de/i:39292'],
    ['i:35562', '“Escherichia faecalis”', 'SeqCode Registry · Automated discovery', 'https://seqco.de/i:35562'],
    ['i:39947', 'Escherichia whittamii', 'SeqCode Registry · Valid (ICNP)', 'https://seqco.de/i:39947'],
    ['i:7301', 'Escherichia blattae', 'SeqCode Registry · Valid (ICNP)', 'https://seqco.de/i:7301'],
  ],
  pubmed: [
    ['15040260', 'Pathogenic Escherichia coli', 'Kaper JB, Nataro JP, Mobley HL · Nat Rev Microbiol · 2004 · 综述', 'https://pubmed.ncbi.nlm.nih.gov/15040260/'],
    ['10944877', 'Escherichia coli--a review', 'Johnston M · J R Soc Promot Health · 2000 · 综述', 'https://pubmed.ncbi.nlm.nih.gov/10944877/'],
    ['9750364', 'Toxigenic Escherichia coli', 'Chart H · Symp Ser Soc Appl Microbiol · 1998 · 综述', 'https://pubmed.ncbi.nlm.nih.gov/9750364/'],
    ['26004641', 'Escherichia coli in the gut microbiome', 'Smith J, Doe A · Nat Microbiol · 2019', 'https://pubmed.ncbi.nlm.nih.gov/26004641/'],
    ['14008022', 'The ecology of Escherichia coli', 'Lee K, Roe B · Environ Microbiol · 2018', 'https://pubmed.ncbi.nlm.nih.gov/14008022/'],
  ],
  europepmc: [
    ['PMC13663591', 'Mucin Increases the Virulence of Enterotoxigenic Escherichia coli', 'Meo S, Ravikumar A, Noppe C, Defoirdt T. · Biology (Basel) · 2026 · 开放获取', 'https://europepmc.org/article/PMC/PMC13663591'],
    ['PMC13578468', 'Biosynthesis of vanillin glucoside in Escherichia coli', 'Synth Syst Biotechnol · 2026 · 开放获取', 'https://europepmc.org/article/PMC/PMC13578468'],
    ['PMID 42821946', 'Nanocuvettes and their application in Escherichia coli detection', 'De M, Maurya S, Mukherji S. · Opt Lett · 2026', 'https://europepmc.org/article/MED/42821946'],
    ['PPR123', 'A preprint on Escherichia coli ecology', 'Lee K. · bioRxiv · 2025', 'https://europepmc.org/article/PPR/PPR123'],
    ['PPR456', 'Single-cell growth of Escherichia coli in the gut', 'Doe A. · bioRxiv · 2025', 'https://europepmc.org/article/PPR/PPR456'],
  ],
  openalex: [
    ['10.1038/nrmicro818', 'Pathogenic Escherichia coli', 'James B. Kaper, James P. Nataro, Harry L. T. Mobley · Nature Reviews Microbiology · 2004 · 被引 5577', 'https://doi.org/10.1038/nrmicro818'],
    ['10.1038/158558a0', 'Gene Recombination in Escherichia Coli', 'Joshua Lederberg, Edward Lawrie Tatum · Nature · 1946 · 被引 609', 'https://doi.org/10.1038/158558a0'],
    ['10.1007/978-3-540-75418-3_12', 'Escherichia coli Biofilms', 'Christophe Beloin, Agnès Roux, Jean-Marc Ghigo · Current topics in microbiology and immunology · 2008 · 被引 587', 'https://doi.org/10.1007/978-3-540-75418-3_12'],
    ['10.1126/science.1058377', 'The gut microbiome and Escherichia coli', 'Ley RE, Peterson DA, Gordon JI · Science · 2006 · 被引 1204', 'https://doi.org/10.1126/science.1058377'],
    ['10.1038/nature123', 'Escherichia coli metabolism in the gut', 'Ada Lovelace, Alan Turing · Nature · 2023 · 被引 142', 'https://doi.org/10.1038/nature123'],
  ],
}

const itemObjects = Object.fromEntries(
  Object.entries(ITEMS).map(([sourceId, rows]) => [
    sourceId,
    rows.map(([id, title, description, url]) => ({ id, title, description, url })),
  ]),
)

const harness = await startHarness()
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH === undefined ? {} : { executablePath: process.env.CHROME_PATH }),
  headless: true,
})
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
page.setDefaultTimeout(10000)

try {
  await page.route('**/plugins/dsh-multidb-lens/search', async (route) => {
    const request = route.request()
    const body = request.postDataJSON()
    const query = typeof body?.query === 'string' ? body.query : 'Escherichia coli'
    const descriptors = SOURCE_META.map(({ id, name, subtitle, homepage }) => ({ id, name, subtitle, homepage }))
    const events = [
      {
        type: 'meta',
        query,
        truncated: false,
        length: Array.from(query).length,
        maxQueryChars: 200,
        mode: 'all',
        sourceId: null,
        sourceIds: descriptors.map((source) => source.id),
        adaptive: true,
        queryKind: 'taxon',
        queryLabel: '物种/分类名',
        detectedValue: query,
        sequenceType: null,
        sources: descriptors,
      },
      ...descriptors.map((source, index) => ({
        type: 'source',
        id: source.id,
        status: 'ok',
        elapsedMs: 260 + index * 35,
        cached: false,
        items: itemObjects[source.id],
        total: TOTALS[source.id],
      })),
      { type: 'done', elapsedMs: 920 },
    ]
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' },
      body: `${events.map((event) => JSON.stringify(event)).join('\n')}\n`,
    })
  })

  await page.goto(harness.url)
  await page.waitForFunction(() => window.__ready === true)

  await page.evaluate(() => {
    document.title = 'E. coli · multi-database review'
    const title = document.querySelector('h1')
    if (title !== null) title.textContent = 'Gut microbiome literature review'
    const sidebar = document.querySelector('#sidebar')
    if (sidebar !== null) {
      sidebar.innerHTML = '<h3>Research session</h3><p>E. coli ecology</p><p>Taxonomy · rRNA · literature</p>'
    }
    const conversation = document.querySelector('#conversation')
    if (conversation !== null) {
      conversation.innerHTML = `
        <div data-chat-flow-kind="user"><p>Can you compare the taxonomy and key literature for Escherichia coli?</p></div>
        <div data-chat-flow-kind="assistant">
          <p><span id="demo-term">Escherichia coli</span> is a model organism in gut microbiome research. Its taxonomy, rRNA references and literature are spread across several databases.</p>
          <p>Select a term to search all sources, or open one database from the menu.</p>
        </div>`
    }
    const editor = document.querySelector('#editor')
    if (editor !== null) {
      editor.innerHTML = '<span style="color:#9aa0a6">Ask a follow-up…</span>'
    }
  })

  const selectTerm = async () => {
    await page.evaluate(() => {
      const node = document.querySelector('#demo-term')
      if (node === null) throw new Error('demo term missing')
      const range = document.createRange()
      range.selectNodeContents(node)
      const selection = window.getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
      const rect = node.getBoundingClientRect()
      node.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      }))
    })
    const menu = page.locator('.dsh-multidb-lens-menu')
    await menu.waitFor()
    return menu
  }

  const menu = await selectTerm()
  await menu.getByRole('menuitem', { name: /单库搜索/u }).hover()
  await menu.locator('.dsh-multidb-lens-submenu').waitFor()
  await page.waitForTimeout(200)
  await page.screenshot({ path: path.join(docs, 'submenu.png') })

  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.locator('.dsh-multidb-lens-menu').waitFor({ state: 'detached' })

  const menuForSearch = await selectTerm()
  await menuForSearch.getByRole('menuitem', { name: /全库搜索/u }).click()
  const frame = await (async () => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const candidate = page.frames().find((entry) => entry !== page.mainFrame())
      if (candidate !== undefined) {
        await candidate.locator('.md-title').waitFor()
        return candidate
      }
      await page.waitForTimeout(50)
    }
    throw new Error('result frame did not appear')
  })()
  await frame.waitForFunction(() => document.querySelectorAll('.md-card').length >= 50)
  await page.waitForTimeout(250)
  await page.screenshot({ path: path.join(docs, 'panel.png') })

  console.log(`updated ${path.join(docs, 'submenu.png')}`)
  console.log(`updated ${path.join(docs, 'panel.png')}`)
} finally {
  await browser.close()
  await harness.close()
}
