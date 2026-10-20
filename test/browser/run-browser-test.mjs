import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { startHarness } from './server.mjs'

/**
 * Browser-level acceptance harness for the client bundle.
 *
 * Setup (dev only, not part of the published plugin):
 *   cd test/browser
 *   npm install react@18.3.1 react-dom@18.3.1 playwright-core
 *   export CHROME_PATH=/path/to/chrome        # or install Playwright Chromium
 *   node run-browser-test.mjs
 */
const CHROME = process.env.CHROME_PATH
const artifacts = path.join(tmpdir(), 'dsh-multidb-harness')
await mkdir(artifacts, { recursive: true })

const checks = []
const check = (name) => {
  checks.push(name)
  console.log(`PASS ${name}`)
}

const harness = await startHarness()
const browser = await chromium.launch({
  ...(CHROME === undefined ? {} : { executablePath: CHROME }),
  headless: true,
})
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
const page = await context.newPage()
page.setDefaultTimeout(8000)
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(String(error)))

async function clearSelection() {
  await page.evaluate(() => window.getSelection()?.removeAllRanges())
}

async function selectText(selector) {
  await page.evaluate((sel) => {
    const node = document.querySelector(sel)
    if (node === null) throw new Error(`missing ${sel}`)
    const range = document.createRange()
    range.selectNodeContents(node)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
  }, selector)
}

async function rightClick(selector) {
  return page.evaluate((sel) => {
    const node = document.querySelector(sel)
    if (node === null) throw new Error(`missing ${sel}`)
    const rect = node.getBoundingClientRect()
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: rect.left + 24,
      clientY: rect.top + 12,
    })
    return { notPrevented: node.dispatchEvent(event) }
  }, selector)
}

async function openMenu(selector) {
  await selectText(selector)
  const result = await rightClick(selector)
  assert.equal(result.notPrevented, false, 'selection context menu should be intercepted')
  const menu = page.locator('.dsh-multidb-lens-menu')
  await menu.waitFor()
  return menu
}

async function getFrame() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const frame = page.frames().find((candidate) => candidate !== page.mainFrame())
    if (frame !== undefined) {
      await frame.locator('.md-title').waitFor({ timeout: 8000 })
      return frame
    }
    await page.waitForTimeout(50)
  }
  throw new Error('result frame did not appear')
}

async function startSearch(selector) {
  const menu = await openMenu(selector)
  await menu.getByRole('menuitem', { name: /全库搜索/u }).click()
  await page.locator('.dsh-multidb-lens-window').waitFor()
  return getFrame()
}

async function openSingleSubmenu(menu) {
  const single = menu.getByRole('menuitem', { name: /单库搜索/u })
  await single.hover()
  const submenu = menu.locator('.dsh-multidb-lens-submenu')
  await submenu.waitFor()
  return { single, submenu }
}

async function startSingleSearch(selector, sourceName) {
  const menu = await openMenu(selector)
  const { submenu } = await openSingleSubmenu(menu)
  await submenu.getByRole('menuitem', { name: new RegExp(`^${sourceName}`, 'u') }).click()
  await page.locator('.dsh-multidb-lens-window').waitFor()
  return getFrame()
}

try {
  await page.goto(harness.url)
  await page.waitForFunction(() => window.__ready === true)

  // 1. No selection: system menu must be untouched.
  await clearSelection()
  let event = await rightClick('#assistant-main')
  assert.equal(event.notPrevented, true, 'empty selection must not be intercepted')
  await page.waitForTimeout(80)
  assert.equal(await page.locator('.dsh-multidb-lens-menu').count(), 0)
  check('no selection: contextmenu untouched and no custom item')

  // 2. Selection outside the conversation: untouched.
  await selectText('#sidebar-text')
  event = await rightClick('#sidebar-text')
  assert.equal(event.notPrevented, true, 'sidebar selection must not be intercepted')
  await page.waitForTimeout(80)
  assert.equal(await page.locator('.dsh-multidb-lens-menu').count(), 0)
  check('selection outside conversation: no interception')

  // 3. Selection inside the composer: untouched.
  await selectText('#editor')
  event = await rightClick('#editor')
  assert.equal(event.notPrevented, true, 'composer selection must not be intercepted')
  await page.waitForTimeout(80)
  assert.equal(await page.locator('.dsh-multidb-lens-menu').count(), 0)
  check('selection inside composer: no interception')

  // 4. Conversation selection: custom menu with Copy + 全库搜索 + 单库搜索.
  await selectText('#assistant-main')
  event = await rightClick('#assistant-main')
  assert.equal(event.notPrevented, false)
  const menu = page.locator('.dsh-multidb-lens-menu')
  await menu.waitFor()
  assert.equal(await menu.locator('.dsh-multidb-lens-menu-item').count(), 5)
  const menuText = await menu.innerText()
  assert.ok(menuText.includes('复制'))
  assert.ok(menuText.includes('全库搜索'))
  assert.ok(menuText.includes('单库搜索'))
  assert.ok(menuText.includes('智能检索词'))
  assert.ok(menuText.includes('BLAST 比对'))
  const smart = menu.getByRole('menuitemcheckbox', { name: /智能检索词/u })
  assert.equal(await smart.getAttribute('aria-checked'), 'true')
  await smart.click()
  assert.equal(await smart.getAttribute('aria-checked'), 'false')
  await smart.click()
  assert.equal(await smart.getAttribute('aria-checked'), 'true')
  check('conversation selection: Copy + 全库搜索 + 单库搜索 + 智能检索词')

  // 5. Hovering 单库搜索 opens the nested database menu.
  const { single, submenu } = await openSingleSubmenu(menu)
  assert.equal(await single.getAttribute('aria-expanded'), 'true')
  assert.equal(await submenu.locator('.dsh-multidb-lens-menu-item').count(), 10)
  assert.equal(await submenu.getByRole('menuitemcheckbox').count(), 10)
  const submenuText = await submenu.innerText()
  for (const name of ['NCBI Protein', 'UniProtKB', 'GTDB', 'BacDive', 'SILVA', 'LPSN', 'SeqCode', 'PubMed', 'Europe PMC', 'OpenAlex']) {
    assert.ok(submenuText.includes(name), `${name} missing from submenu`)
  }
  assert.ok(submenuText.includes('勾选决定全库范围'))
  await page.screenshot({ path: path.join(artifacts, 'submenu.png') })
  check('hover 单库搜索 reveals all ten databases, checkboxes and sort handles')

  // 6. Excluding a source narrows full search.
  const openAlexToggle = submenu.getByRole('menuitemcheckbox', { name: /OpenAlex/u })
  assert.equal(await openAlexToggle.getAttribute('aria-checked'), 'true')
  await openAlexToggle.click()
  assert.equal(await openAlexToggle.getAttribute('aria-checked'), 'false')
  assert.ok((await menu.innerText()).includes('9 个库'))
  await menu.getByRole('menuitem', { name: /全库搜索/u }).click()
  const narrowedFrame = await getFrame()
  assert.equal(await narrowedFrame.locator('.md-source').count(), 9)
  assert.equal(harness.state.requests.at(-1).sources.includes('openalex'), false)
  assert.equal(harness.state.requests.at(-1).sources.length, 9)
  await narrowedFrame.locator('button[aria-label="关闭检索结果"]').click()
  await page.locator('.dsh-multidb-lens-window').waitFor({ state: 'detached' })

  const menuReenable = await openMenu('#assistant-main')
  const reenable = await openSingleSubmenu(menuReenable)
  await reenable.submenu.getByRole('menuitemcheckbox', { name: /OpenAlex/u }).click()
  assert.ok((await menuReenable.innerText()).includes('10 个库'))
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  check('unchecking a database narrows full search, re-checking restores it')

  // 7. Arrow controls reorder sources and the order persists in the menu.
  const menuSort = await openMenu('#assistant-main')
  const sortSubmenu = await openSingleSubmenu(menuSort)
  const rows = sortSubmenu.submenu.locator('.dsh-multidb-lens-source-row')
  const firstBefore = (await rows.nth(0).innerText()).trim()
  await sortSubmenu.submenu.getByRole('button', { name: '上移 UniProtKB' }).click()
  assert.ok((await rows.nth(0).innerText()).includes('UniProtKB'), `sort did not move UniProtKB above ${firstBefore}`)
  await sortSubmenu.submenu.getByRole('button', { name: '下移 UniProtKB' }).click()
  assert.ok((await rows.nth(0).innerText()).includes('NCBI Protein'))
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  check('arrow controls reorder sources and restore the order')

  // 8. Single-database mode runs only GTDB and labels the panel accordingly.
  const win = page.locator('.dsh-multidb-lens-window')
  const frame = await startSingleSearch('#assistant-main', 'GTDB')
  await win.waitFor()
  const iframe = win.locator('iframe')
  assert.equal(await iframe.getAttribute('sandbox'), 'allow-scripts')
  assert.equal((await iframe.getAttribute('sandbox')).includes('allow-same-origin'), false)
  assert.equal((await frame.locator('.md-title').innerText()).trim(), '单库检索结果')
  assert.equal(await frame.locator('.md-source').count(), 1)
  assert.equal(await frame.locator('.md-loading').count(), 1)
  const lastRequest = harness.state.requests.at(-1)
  assert.equal(lastRequest.mode, 'single')
  assert.equal(lastRequest.source, 'gtdb')
  await frame.locator('.md-source').filter({ hasText: 'GTDB' }).locator('.md-card').first().waitFor()
  assert.equal(await frame.locator('.md-card').count(), 2)
  assert.equal(await frame.locator('.md-error').count(), 0)
  assert.ok((await frame.locator('.md-card').first().innerText()).includes('Escherichia coli K-12'))
  check('single-database search requests only GTDB and renders one section')

  // 9. Result actions copy an identifier and insert a citation into the composer.
  await page.evaluate(() => {
    window.__copied = []
    try {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: (text) => { window.__copied.push(text); return Promise.resolve() } },
      })
    } catch {
      // keep the fallback path
    }
  })
  await frame.locator('.md-action', { hasText: '复制 ID' }).first().click()
  await page.waitForFunction(() => Array.isArray(window.__copied) && window.__copied.length > 0)
  assert.equal(await page.evaluate(() => window.__copied[0]), 'GCA_000001.1')

  await page.evaluate(() => {
    const editor = document.querySelector('#editor')
    if (editor !== null) editor.textContent = ''
  })
  await frame.locator('.md-action', { hasText: '插入输入框' }).first().click()
  await page.waitForFunction(() => document.querySelector('#editor')?.textContent.includes('Escherichia coli K-12'))
  const editorText = await page.locator('#editor').innerText()
  assert.ok(editorText.includes('https://gtdb.ecogenomic.org/'))
  assert.ok((await page.locator('.dsh-multidb-lens-toast').innerText()).includes('已插入输入框'))
  check('result cards copy IDs and insert citations into the composer')

  // 10. External GTDB links go through the host page.
  await page.evaluate(() => {
    window.__opened = []
    window.open = (...args) => {
      window.__opened.push(args)
      return {}
    }
  })
  await frame.locator('.md-link').first().click()
  await page.waitForFunction(() => Array.isArray(window.__opened) && window.__opened.length > 0)
  const gtdbOpened = await page.evaluate(() => window.__opened[0])
  assert.ok(gtdbOpened[0].startsWith('https://gtdb.ecogenomic.org/'))
  assert.equal(gtdbOpened[1], '_blank')
  assert.equal(gtdbOpened[2], 'noopener,noreferrer')
  await frame.locator('button[aria-label="关闭检索结果"]').click()
  await page.locator('.dsh-multidb-lens-window').waitFor({ state: 'detached' })
  check('GTDB link opens via host window.open with the GTDB host allowlist')

  // 11. A DNA selection gets a prefilled NCBI BLAST action.
  await selectText('#assistant-sequence')
  event = await rightClick('#assistant-sequence')
  assert.equal(event.notPrevented, false)
  const sequenceMenu = page.locator('.dsh-multidb-lens-menu')
  await sequenceMenu.waitFor()
  assert.equal(await sequenceMenu.locator('.dsh-multidb-lens-menu-item').count(), 5)
  const blastButton = sequenceMenu.getByRole('menuitem', { name: /BLAST 比对/u })
  await blastButton.hover()
  const blastMenu = sequenceMenu.locator('.dsh-multidb-lens-submenu')
  await blastMenu.waitFor()
  await page.evaluate(() => {
    window.__opened = []
    window.open = (...args) => {
      window.__opened.push(args)
      return {}
    }
  })
  await blastMenu.getByRole('menuitem', { name: /NCBI BLAST/u }).click()
  await page.waitForFunction(() => Array.isArray(window.__opened) && window.__opened.length > 0)
  const blastOpened = await page.evaluate(() => window.__opened[0])
  assert.ok(blastOpened[0].startsWith('https://blast.ncbi.nlm.nih.gov/Blast.cgi?PROGRAM=blastn'))
  assert.ok(blastOpened[0].includes('QUERY=ACGTACGT'))
  assert.equal(blastOpened[1], '_blank')
  assert.equal(await page.locator('.dsh-multidb-lens-menu').count(), 0)
  check('DNA selection offers a prefilled NCBI BLAST action')

  // 8. Full search opens every database with independent loading blocks.
  const frameFull = await startSearch('#assistant-main')
  assert.equal((await frameFull.locator('.md-title').innerText()).trim(), '全库检索结果')
  assert.equal(await frameFull.locator('.md-source').count(), 10)
  assert.equal(await frameFull.locator('.md-loading').count(), 10)
  await frameFull.locator('.md-source').filter({ hasText: 'NCBI Protein' }).locator('.md-card').first().waitFor()
  const ncbiSection = frameFull.locator('.md-source').filter({ hasText: 'NCBI Protein' })
  const uniSection = frameFull.locator('.md-source').filter({ hasText: 'UniProtKB' })
  assert.equal(await ncbiSection.locator('.md-card').count(), 2)
  assert.equal(await uniSection.locator('.md-loading').count(), 1)
  check('full search opens ten loading blocks; NCBI cards arrive first')

  // 9. UniProt failure arrives independently; other databases stay visible.
  await uniSection.locator('.md-error strong').waitFor()
  assert.equal((await uniSection.locator('.md-error strong').innerText()).trim(), '该库查询失败')
  assert.equal(await ncbiSection.locator('.md-card').count(), 2)
  assert.equal((await ncbiSection.locator('.md-card-title').first().innerText()).trim(), 'Hemoglobin subunit alpha')
  assert.equal((await ncbiSection.locator('.md-id').first().innerText()).trim(), 'NP_000001.1')
  for (const name of ['GTDB', 'SILVA', 'PubMed', 'Europe PMC', 'OpenAlex']) {
    assert.equal(
      await frameFull.locator('.md-source').filter({ hasText: name }).locator('.md-card').count(),
      2,
      `${name} should keep its results after UniProt fails`,
    )
  }
  assert.equal(pageErrors.length, 0, pageErrors.join('\n'))
  check('one database failure leaves the other nine database results visible')

  await page.screenshot({ path: path.join(artifacts, 'panel.png') })

  // 10. Sandbox isolation: opaque origin, no parent DOM, no network egress.
  assert.equal(await frameFull.evaluate(() => location.origin), 'null')
  assert.equal(await frameFull.evaluate(() => {
    try {
      return window.parent.document === null ? 'none' : 'accessible'
    } catch {
      return 'blocked'
    }
  }), 'blocked')
  assert.equal(await frameFull.evaluate(async () => {
    try {
      await fetch('https://example.com/')
      return 'allowed'
    } catch {
      return 'blocked'
    }
  }), 'blocked')
  check('iframe is opaque-origin, blocked from parent DOM and network')

  // 11. NCBI link remains host-opened, not iframe navigation.
  await page.evaluate(() => {
    window.__opened = []
    window.open = (...args) => {
      window.__opened.push(args)
      return {}
    }
  })
  await ncbiSection.locator('.md-link').first().click()
  await page.waitForFunction(() => Array.isArray(window.__opened) && window.__opened.length > 0)
  const opened = await page.evaluate(() => window.__opened[0])
  assert.equal(opened[0], 'https://www.ncbi.nlm.nih.gov/protein/NP_000001.1')
  assert.equal(opened[1], '_blank')
  assert.equal(opened[2], 'noopener,noreferrer')
  assert.equal(page.frames().length, 2, 'link click must not navigate the iframe')

  // Literature link hosts must pass the same host allowlist.
  for (const [section, expected] of [
    ['PubMed', 'https://pubmed.ncbi.nlm.nih.gov/10944877/'],
    ['Europe PMC', 'https://europepmc.org/article/MED/39000001'],
    ['OpenAlex', 'https://doi.org/10.1038/nature123'],
  ]) {
    await page.evaluate(() => { window.__opened = [] })
    await frameFull.locator('.md-source').filter({ hasText: section }).locator('.md-link').first().click()
    await page.waitForFunction(() => Array.isArray(window.__opened) && window.__opened.length > 0)
    const target = await page.evaluate(() => window.__opened[0])
    assert.equal(target[0], expected)
    assert.equal(target[1], '_blank')
    assert.equal(target[2], 'noopener,noreferrer')
    assert.equal(page.frames().length, 2, `${section} link must not navigate the iframe`)
  }
  check('links to NCBI, PubMed, Europe PMC and DOI open via host window.open')

  // 12. Minimize and restore.
  await frameFull.locator('button[aria-label="最小化结果窗口"]').click()
  await page.waitForFunction(() => document.querySelector('.dsh-multidb-lens-window')?.getAttribute('data-minimized') === 'true')
  await page.waitForTimeout(200)
  const minimizedBox = await win.boundingBox()
  assert.ok(minimizedBox !== null && minimizedBox.height >= 47 && minimizedBox.height <= 49, `height ${minimizedBox?.height}`)
  assert.equal(await frameFull.locator('.md-body').count(), 0)
  await frameFull.locator('button[aria-label="展开结果窗口"]').click()
  await page.waitForFunction(() => document.querySelector('.dsh-multidb-lens-window')?.getAttribute('data-minimized') === 'false')
  await frameFull.locator('.md-body').waitFor()
  // Let the post-restore state message rebuild the iframe DOM before clicking
  // its close button; clicking exactly during that replacement is a test race.
  await page.waitForTimeout(200)
  check('window minimizes to a 48px titlebar and restores')

  // 13. Close; verify the iframe is gone.
  await frameFull.locator('button[aria-label="关闭检索结果"]').click()
  await page.locator('.dsh-multidb-lens-window').waitFor({ state: 'detached' })
  assert.equal(await page.locator('iframe').count(), 0)
  check('window closes and removes the iframe')

  // 14. Reopen after close; ALL_OK returns all ten databases.
  const frame2 = await startSearch('#assistant-allok')
  await frame2.locator('.md-source').filter({ hasText: 'UniProtKB' }).locator('.md-card').first().waitFor()
  assert.equal(await page.locator('.dsh-multidb-lens-window').count(), 1)
  assert.equal(await frame2.locator('.md-error').count(), 0)
  assert.equal(await frame2.locator('.md-source').count(), 10)
  assert.equal(await frame2.locator('.md-card').count(), 20)
  assert.equal(harness.state.requests.at(-1).behavior, 'all-ok')
  check('reopen after close works; a single window shows all ten databases')

  // 15. Long selection is truncated to 200 code points with a notice.
  const frame3 = await startSearch('#assistant-long')
  await frame3.locator('.md-notice').filter({ hasText: '检索词已截断' }).waitFor()
  assert.equal(harness.state.requests.at(-1).length, 200)
  assert.equal(Array.from(harness.state.requests.at(-1).query).length, 200)
  check('overlong selection is truncated to 200 chars with 检索词已截断 notice')

  // 16. Per-source load more and page-size selector use the fetched page.
  const frameMany = await startSingleSearch('#assistant-many', 'NCBI Protein')
  await frameMany.locator('.md-card').first().waitFor()
  assert.equal(await frameMany.locator('.md-card').count(), 5)
  assert.equal(await frameMany.locator('.md-more').count(), 1)
  await frameMany.locator('.md-more').click()
  assert.equal(await frameMany.locator('.md-card').count(), 7)
  assert.equal(await frameMany.locator('.md-more').count(), 0)
  await frameMany.locator('select[data-action="page-size"]').selectOption('10')
  assert.equal(await frameMany.locator('.md-card').count(), 7)
  await frameMany.locator('button[aria-label="关闭检索结果"]').click()
  await page.locator('.dsh-multidb-lens-window').waitFor({ state: 'detached' })
  check('cards load more per source and the page-size selector rerenders')

  // 17. Smart detection is visible and can be retried with the raw query.
  const frameDoi = await startSearch('#assistant-doi')
  await frameDoi.locator('.md-notice').filter({ hasText: '智能检索' }).waitFor()
  assert.equal(harness.state.requests.at(-1).adaptive, true)
  assert.equal(harness.state.requests.at(-1).query, '10.1038/nature123')
  await frameDoi.locator('.md-notice-action').click()
  await frameDoi.locator('.md-notice').filter({ hasText: '原文检索' }).waitFor()
  assert.equal(harness.state.requests.at(-1).adaptive, false)
  await frameDoi.locator('button[aria-label="关闭检索结果"]').click()
  await page.locator('.dsh-multidb-lens-window').waitFor({ state: 'detached' })
  check('smart detection is shown and can be retried with the raw query')

  // 18. Rapid triggers replace instead of stacking windows.
  const before = harness.state.requests.length
  for (let i = 0; i < 3; i += 1) {
    await selectText('#assistant-main')
    const result = await rightClick('#assistant-main')
    assert.equal(result.notPrevented, false)
    await page.locator('.dsh-multidb-lens-menu-item', { hasText: '全库搜索' }).click()
    await page.waitForTimeout(120)
  }
  assert.equal(await page.locator('.dsh-multidb-lens-window').count(), 1)
  assert.equal(harness.state.requests.length, before + 3)
  await page.waitForTimeout(2100)
  assert.equal(await page.locator('iframe').count(), 1)
  assert.equal(pageErrors.length, 0, pageErrors.join('\n'))
  check('rapid triggers reuse one window and abort superseded requests')

  // 17. Final close, no-selection behavior still intact.
  const finalFrame = await getFrame()
  await finalFrame.locator('button[aria-label="关闭检索结果"]').click()
  await page.locator('.dsh-multidb-lens-window').waitFor({ state: 'detached' })
  await clearSelection()
  event = await rightClick('#assistant-main')
  assert.equal(event.notPrevented, true)
  assert.equal(await page.locator('.dsh-multidb-lens-menu').count(), 0)
  const windowErrors = await page.evaluate(() => window.__errors)
  assert.deepEqual(windowErrors, [])
  check('clean teardown; no uncaught page errors')

  console.log(`\n${checks.length} browser checks passed`)
} catch (error) {
  console.error('\nBROWSER TEST FAILED')
  console.error(error)
  console.error('pageErrors:', pageErrors)
  try {
    await page.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true })
  } catch {
    // ignore
  }
  process.exitCode = 1
} finally {
  await browser.close()
  await harness.close()
}
