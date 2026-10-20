# dsh-multidb-lens · 划词多库透镜

[English](README.md) | 简体中文

DeepSeek Harness（dsh）Web UI 插件：在会话正文中**选中一段文本**，右键即可选择：

- **全库搜索**：并行查询全部 10 个数据库；
- **单库搜索**：鼠标悬停在「单库搜索」上展开下级菜单，选择任意一个数据库单独查询。

数据库覆盖蛋白记录、微生物生态与演化、生命科学文献三类。每个数据库独立加载、独立失败：一个库超时或报错不会挡住其他库。结果按数据库分组显示在一个沙箱 iframe 结果窗口里。

![概念](https://img.shields.io/badge/dsh--plugin-0.1.0-blue)

![浏览器 harness 中的单库子菜单](docs/submenu.png)

---

## 数据库

| ID | 数据库 | 主要覆盖 | 接入方式 |
|----|--------|----------|----------|
| `ncbi` | **NCBI Protein** | 蛋白序列 | E-utilities `esearch → esummary`（默认 `db=protein`） |
| `uniprot` | **UniProtKB** | 蛋白功能与注释 | UniProt REST `uniprotkb/search` |
| `gtdb` | **GTDB** | 细菌/古菌基因组分类与系统发育 | GTDB 公共 FastAPI `/search/gtdb`，返回基因组、GTDB 谱系与种代表标记 |
| `bacdive` | **BacDive** | 菌株表型、培养与分离信息（DSMZ） | 公开网站检索页 `bacdive.dsmz.de/search`（官方 REST API 现需账号） |
| `silva` | **SILVA** | SSU rRNA 参考序列与分类 | SILVA Web Service `legatum.arb-silva.de/WS/`，并行取统计与结果 |
| `lpsn` | **LPSN** | 原核生物命名与有效发表状态 | 公开检索页 `lpsn.dsmz.de/search` |
| `seqcode` | **SeqCode** | 未培养原核生物的基因组命名 | SeqCode Registry 检索页 `registry.seqco.de/search` |
| `pubmed` | **PubMed** | 生物医学与生命科学文献 | NCBI E-utilities `esearch → esummary`（`db=pubmed`） |
| `europepmc` | **Europe PMC** | PubMed、PMC 全文与 bioRxiv/medRxiv 预印本 | Europe PMC REST `search`（`resultType=lite`） |
| `openalex` | **OpenAlex** | 开放学术文献索引、DOI 与被引信息 | OpenAlex REST `/works` |

- 5 个微生物库面向微生物生态、微生物演化与微生物命名；GTDB、SILVA、SeqCode 尤其适合未培养微生物和 MAG 相关检索。
- 3 个文献库面向论文查找：PubMed 是经典生物医学索引，Europe PMC 覆盖预印本与开放获取全文，OpenAlex 提供跨学科的 DOI 与被引元数据。

## 功能

- **右键菜单**：只有选中文本、且选区位于会话正文（`[data-chat-flow]`）内时才出现自定义菜单；菜单包含 **复制**、**全库搜索**、**单库搜索 ▸**、**智能检索词**，选中序列或 UniProt 登录号时还会出现 **BLAST 比对 ▸**。没有选区、选区在输入框或侧边栏时完全不动系统右键菜单。
- **单库子菜单**：鼠标悬停在「单库搜索」上即展开 10 个数据库；支持点击名称单独检索、复选框控制全库范围、`▲▼` 调整顺序（顺序与开关持久化到 `localStorage`），并支持 `ArrowRight` / `ArrowDown` 进入、`ArrowLeft` 返回。子菜单会按视口边缘自动左右翻转、上下对齐，条目超出高度时可滚动。
- **智能检索词**：自动识别 DOI、PMID、UniProt / NCBI / GTDB 登录号、核酸/蛋白序列和物种名，再按各库语法改写查询（例如 PubMed 的 `[DOI]`、UniProt 的 `organism_name:`、Europe PMC 的 `TITLE_ABS:`、OpenAlex 的 DOI/PMID filter）。结果窗口会显示识别结果，并可一键「按原文重试」或切回智能模式。
- **BLAST**：选中 DNA / 蛋白序列或 UniProt 登录号时，右键菜单直接提供预填查询的 NCBI BLAST（`blastn` / `blastp`）；登录号还可打开 UniProt BLAST。
- **选区清洗**：trim 首尾空白、把换行与连续空白合并为一个空格；不做纠错。超过 200 个字符时截断为前 200 个字符，并在结果窗口顶部显示「检索词已截断」。
- **两种结果模式**：全库搜索标题为 **全库检索结果**，显示启用中的数据库区块；单库搜索标题为 **单库检索结果**，只显示所选数据库的一个区块，宿主也只查询该库。
- **结果窗口**：每库默认显示 5 条，可切换每库 5 / 10 / 20 条；单次最多取回 20 条，超出时提供「再显示 N 条」。卡片支持打开条目、复制 ID、复制引文、插入输入框、让 AI 继续分析；窗口可最小化为 48px 标题条，可关闭。
- **短时缓存**：同一查询、同一来源、同一模式（智能/原文）在 5 分钟内复用成功结果，失败和超时不会写入缓存；缓存只在宿主进程内存中，重启即清空。
- **独立加载与失败**：窗口打开即显示所有目标来源的 loading；每个来源就绪/失败后立刻更新自己的区块。失败区块显示 **该库查询失败** 或 **该库查询超时** 及简短原因（如 `HTTP 429`、`网络连接失败`），不会静默消失，也没有未捕获异常。
- **安全**：结果全部由 `sandbox="allow-scripts"` 的 iframe 渲染（**不含** `allow-same-origin`、`allow-popups`、`allow-forms`、`allow-top-navigation`），iframe 内还有 `connect-src 'none'` 的 CSP，无法访问宿主 DOM、Cookie、Storage 或发起网络请求；卡片链接点击后由宿主页校验域名（仅下列数据库的 https 链接）并 `window.open(url, '_blank', 'noopener,noreferrer')`，不在 iframe 内导航。
  - 允许的链接域名：`ncbi.nlm.nih.gov`、`uniprot.org`、`gtdb.ecogenomic.org`、`bacdive.dsmz.de`、`arb-silva.de`、`lpsn.dsmz.de`、`seqco.de`、`pubmed.ncbi.nlm.nih.gov`、`europepmc.org`、`doi.org`、`openalex.org`、`blast.ncbi.nlm.nih.gov`。

## 安装

要求 dsh（桌面端或 `dsh web`）可用，`dsh` 在 PATH 中。`<profile>` 用实际启动的 profile：桌面端通常是 `desktop`，Web 版通常是 `web`。

从本地目录安装：

```sh
dsh plugin --profile <profile> add file:/绝对路径/dsh-multidb-lens
```

从 GitHub 安装（把 `<owner>` 换成实际托管仓库的账号或组织）：

```sh
dsh plugin --profile <profile> add github:<owner>/dsh-multidb-lens
```

安装后：

1. 重启 dsh（宿主半需要在启动时注册检索路由与客户端 bundle）；
2. 刷新页面（Ctrl/Cmd+Shift+R）；
3. 在任意会话正文里选中文本 → 右键 → **全库搜索**，或悬停 **单库搜索** 选择单个库。

卸载：

```sh
dsh plugin --profile <profile> remove dsh-multidb-lens
```

> 本地开发提示：dsh 安装时会复制一份快照。改完 `src/` 或 `lib/` 后要重新执行一次 `add`（或同步到 profile 的 `node_modules/dsh-multidb-lens/`）并重启，才会生效。

## 配置（可选 NCBI API key）

只有 NCBI 有可选凭据（NCBI Protein 与 PubMed 共用）；其余 8 个数据库无需 key。未配置时，本插件按 NCBI 的无 key 约束运行：所有 NCBI 请求经过进程内串行队列，请求间隔 350 ms（≈ 2.86 req/s，不超过 3 req/s）。配置了 key 也仍然使用这条保守队列。

配置优先级：

1. 插件配置字段 `ncbiApiKey` / `ncbiEmail`（在 profile 的用户补丁层覆盖，例如 `~/.dsh/profiles/<profile>/cordis.patch.yml`）：

   ```yaml
   - id: dsh-multidb-lens
     config:
       ncbiApiKey: '你的 NCBI API key'
       ncbiEmail: 'you@example.com'   # 可选，NCBI 建议携带
   ```

2. 环境变量 `DSH_MULTIDB_LENS_NCBI_API_KEY` / `DSH_MULTIDB_LENS_NCBI_EMAIL`
3. 环境变量 `NCBI_API_KEY` / `NCBI_EMAIL`

API key 只存在于宿主进程：它被追加到 NCBI 请求 URL 上，但不会进入任何响应、日志或浏览器端代码。

## 使用

1. 在会话正文中选中一个物种名、属名、登录号、DOI/PMID、序列或任意文本。
2. 右键：
   - **全库搜索**：并行检索当前启用的数据库；
   - **单库搜索**：悬停后在下级菜单里点名称只查该库，复选框控制全库范围，`▲▼` 调整顺序；
   - **智能检索词**：控制是否按 DOI/PMID/登录号/物种名等实体改写各库查询；
   - **BLAST 比对**：选中序列或 UniProt 登录号时出现，可直接跳到预填的 NCBI / UniProt BLAST。
3. 结果窗口立即打开：目标数据库区块先显示 loading，各自的命中卡片或失败提示到达后单独更新。顶部可切换每库 5/10/20 条，超出时用「再显示 N 条」展开。
4. 卡片操作：
   - 「打开条目 ↗」在系统浏览器或新标签页打开对应页面；
   - 「复制 ID」「复制引文」写入剪贴板；
   - 「插入输入框」把引文插入会话输入框；
   - 「问 AI」插入一段带来源、标题、ID、描述和链接的继续分析提示。
5. 结果窗口顶部会显示智能识别结果；可点「按原文重试」绕过改写，或切回「智能检索」。
6. 右上角 `—` 最小化（只剩标题条），`×` 关闭；关闭后再次划词检索可以重新打开。相同查询在 5 分钟内会复用宿主内存中的成功结果。

## 设计

```
用户选区
  └─ 客户端（lib/client.js）
       ├─ 选区校验（会话正文 + 文本清洗 + 200 字符截断）
       ├─ 菜单偏好（来源开关/顺序/智能模式，localStorage）
       ├─ shell.overlay 槽位：右键菜单（复制 / 全库搜索 / 单库搜索▸ / 智能检索词 / BLAST▸）+ 结果窗口
       └─ POST /plugins/dsh-multidb-lens/search  { query, source? | sources?, adaptive? }   （本地同源，流式 NDJSON）
            └─ 宿主（src/index.js，Cordis 插件）
                 ├─ src/route.js        source(s) 白名单、adaptive、meta.queryKind
                 ├─ src/analyze.js      DOI/PMID/登录号/序列/物种检测与各库查询改写
                 ├─ src/cache.js        5 分钟成功结果缓存（每来源）
                 ├─ src/aggregate.js    Promise.allSettled + 每来源独立超时 + 缓存接入
                 ├─ src/sources.js      10 个数据库适配器与注册表
                 ├─ src/html.js         无依赖 HTML→文本/计数工具
                 ├─ src/rate-limit.js   NCBI 全局串行队列（350 ms）
                 └─ src/http.js         统一 fetchJson / fetchText、错误归一化
```

- **请求契约**：`source`（字符串）表示单库；`sources`（数组）表示全库模式下的来源子集；两者都不传表示全部启用来源。`adaptive: false` 关闭智能改写；`adaptive` 缺省为 `true`。宿主只接受注册表中的 ID，未知 ID 返回 `400 未知数据库`。流里的 `meta` 带 `mode`、`sourceId`、`sourceIds`、`adaptive`、`queryKind`、`queryLabel`、`detectedValue` 和本次目标来源。
- **智能改写**：`src/analyze.js` 先识别实体，再按库拼查询；不认识的文本保持原样。识别结果只影响查询语法，不改变结果卡片中的原始检索词。原文模式完全跳过改写，但仍会报告识别到的是什么，方便一键切换。
- **独立结果流**：宿主不回一个“等齐再返回”的聚合 JSON，而是把每个来源的 settle 事件立刻写成一行 NDJSON（`meta` → 每个 `source` → `done`）。浏览器边收边把状态转发给 iframe，所以快库先显示、慢库继续 loading。
- **错误隔离**：核心聚合用 `Promise.allSettled`（`src/aggregate.js`）；每个来源有独立的超时（GTDB / PubMed 15 s，SILVA / SeqCode 12 s，其余 9 s；`AbortController` + 竞速计时器），单个来源的 reject 只会变成该区块的错误提示。
- **分页与缓存**：路由按来源一次取回最多 20 条，iframe 本地按 5/10/20 展示，所以「再显示」不产生新请求；重复的同一查询由宿主缓存 5 分钟。缓存只存成功结果，失败/超时下次会重试。
- **限流**：`ncbiRateLimiter` 是全进程单队列，NCBI Protein 与 PubMed 共用，多个并发检索不会放大 NCBI 出站速率；HTTP 429 会礼貌等待 1 秒重试一次，再失败就作为该库错误显示。Europe PMC 与 OpenAlex 各自只有一个请求，不额外限流。
- **宿主执行、前端仅展示**：所有外部 HTTP、API key、HTML 解析与映射都在 Node 端；客户端只调用本机路由并把结构化结果交给沙箱 iframe。iframe 内没有 API endpoint、没有 key、没有 `fetch` 权限。
- **无构建前端**：`lib/client.js` 与宿主均采用**无构建的 JavaScript 模块**；包内没有任何运行时依赖（Node 内置 `fetch` + 手写的 StandardSchemaV1 `Config`）。

## 开发与测试

```sh
npm run check     # 全部源码语法检查（含 analyze/cache/html）
npm test          # 55 个 node:test 用例
```

浏览器级验收（加载真实 `lib/client.js`，模拟 dsh 的 DOM 与 `shell.overlay` 槽位，本地 mock 流式路由）：

```sh
cd test/browser
npm install

# 任选一种方式提供浏览器：
export CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
# Windows 示例：export CHROME_PATH="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
# 或者：npm install --no-save playwright && npx playwright install chromium

node run-browser-test.mjs              # 23 项检查

# 重新生成干净的文档截图：
node screenshot.mjs
```

## 验收自测

实测环境：Windows 11 + Node.js 24 + Edge（Playwright harness）；真实上游网络用于 8 个新增数据库的联调。单元测试与浏览器 harness 使用确定性 fixture。

| # | 场景 | 结果与证据 |
|---|------|-----------|
| 1 | 右键菜单有两种模式与智能开关 | 已验证：harness 检查 4：含 UniProt 登录号的选区菜单为 5 项（复制 / 全库搜索 / 单库搜索 / 智能检索词 / BLAST 比对）；智能开关的 `aria-checked` 可在开/关间切换；无选区、侧边栏选区、输入框选区均不拦截（检查 1–3）。 |
| 2 | 单库子菜单 | 已验证：harness 检查 5：`hover` 后 `aria-expanded=true`，子菜单 10 个数据库、10 个全库开关、10 组 `▲▼`；包含全部 10 个库名；截图 `docs/submenu.png`。 |
| 3 | 来源开关与排序 | 已验证：harness 检查 6–7：取消 OpenAlex 后全库提示变为 9 个库，请求 `sources` 不含 OpenAlex、结果 9 个区块；重新勾选恢复 10 个。`▲` 把 UniProtKB 移到首位、`▼` 恢复，顺序写入 localStorage。 |
| 4 | 单库搜索只查所选库 | 已验证：harness 检查 8：点击 GTDB 后请求体 `source="gtdb"`，标题「单库检索结果」，只有 1 个 GTDB 区块、2 张卡片；`route.test.js` 验证 meta.mode/sourceId 且只发 1 个 source 事件。 |
| 5 | 全库搜索覆盖 10 个库 | 已验证：harness 检查 12–13、18：打开即 10 个 loading 区块；NCBI 先返回时 UniProt 仍 loading；UniProt 失败后其余 9 库结果仍在；ALL_OK 时 10 区块、20 张卡片、0 错误。 |
| 6 | 智能检索词与原文重试 | 已验证：harness 检查 21：DOI 选区显示「智能检索」提示，点击「按原文重试」后新请求 `adaptive=false`，提示切为「原文检索」。`analyze.test.js` 覆盖 DOI/PMID/登录号/序列/物种；`route.test.js` 验证 PubMed 收到 `[DOI]` 改写、原文模式保持原样。真实联调：PubMed DOI 命中 1 条、Europe PMC `TITLE_ABS` 命中 354,962、UniProt `organism_name` 命中 69,248、OpenAlex DOI filter 命中 1。 |
| 7 | BLAST 快捷入口 | 已验证：harness 检查 11：选中 60 nt DNA 后菜单出现「BLAST 比对」，悬停选择 NCBI BLAST，`window.open` 收到 `https://blast.ncbi.nlm.nih.gov/Blast.cgi?PROGRAM=blastn...&QUERY=ACGTACGT...`；UniProt 登录号还会提供 UniProt BLAST 项。 |
| 8 | 结果卡片操作 | 已验证：harness 检查 9：点击「复制 ID」把 `GCA_000001.1` 写入剪贴板；点击「插入输入框」后 `#editor` 含标题与 GTDB 链接，并出现「已插入输入框」提示。卡片同时提供复制引文与「问 AI」。 |
| 9 | 分页与每库条数 | 已验证：harness 检查 20：NCBI 返回 7 条时先显示 5 条和「再显示 5 条」，点击后显示 7 条；把每库条数切到 10，仍显示 7 条且不产生新请求。 |
| 10 | 5 分钟缓存 | 已验证：`cache.test.js` 验证成功结果命中、过期与 LRU；`aggregate.test.js` 验证第二次检索 0 次请求且 `cached=true`；`route.test.js` 验证同一单库请求复用缓存；失败不写入。 |
| 11 | 微生物数据库真实可用 | 已验证：真实网络联调（2026-10-20）：「Escherichia」→ GTDB 1.4 s / BacDive 1.8 s / SILVA 2.9 s / LPSN 1.5 s / SeqCode 1.9 s，全部 `ok`；「Escherichia coli」→ GTDB 6.5 s（冷缓存）/ BacDive 0.8 s / SILVA 1.1 s / LPSN 0.6 s / SeqCode 1.5 s。 |
| 12 | 文献数据库真实可用 | 已验证：真实网络联调（2026-10-20，查询「Escherichia coli」）：PubMed 1.9 s / 470,188 条；Europe PMC 1.0 s / 1,024,753 条；OpenAlex 1.7 s / 1,651,620 条。卡片显示作者、期刊、年份、开放获取/综述/被引标记。 |
| 13 | 单库/全库失败隔离 | 已验证：单元测试：单库 500 / 超时、双库超时都正常 settle；`route.test.js` 验证快库事件先于慢库超时事件；harness 检查 13 验证一个库失败（UniProt）不影响其他 9 个。 |
| 14 | iframe 安全边界 | 已验证：harness 检查 14：sandbox 精确为 `allow-scripts`，`location.origin === 'null'`，访问 `window.parent.document` 抛错，`fetch` 被 CSP 阻止；契约测试断言源码中不出现 `allow-same-origin / allow-popups / allow-forms / allow-top-navigation`。 |
| 15 | 外链只走宿主白名单 | 已验证：harness 检查 10、15：GTDB、NCBI、PubMed、Europe PMC 与 DOI 卡片链接通过 `window.open(..., '_blank', 'noopener,noreferrer')` 打开，iframe 未导航；BLAST 通过同一宿主页面打开。 |
| 16 | 窗口生命周期与快速触发 | 已验证：harness 检查 16–17、22–23：最小化到 48px、还原、关闭移除 iframe、关闭后可重开；快速连续触发 3 次只保留 1 个窗口且旧请求被 abort；`window.__errors` 为空。 |
| 17 | 超长选区截断 | 已验证：harness 检查 19：260 字符选区发送前 200 字符，结果窗口显示「检索词已截断」。 |

补充证据：`test/route.test.js` 确认流式响应中不出现 NCBI API key；`test/sources.test.js` 确认 key 只出现在 NCBI 请求 URL 而绝不出现在返回数据；新增来源的解析测试覆盖 HTML 实体、SILVA 双请求统计、LPSN 命名状态与引号空白、SeqCode 状态列，以及 PubMed 作者/期刊/综述、Europe PMC 预印本、OpenAlex DOI 与被引字段。

## 隐私

- 不包含遥测、统计或后台上报。
- 选中文本只发送给你选择查询的公共数据库。
- 可选的 NCBI API key 只存在于宿主进程，不会写入响应、日志或浏览器代码。
- 结果缓存只在宿主内存中保留 5 分钟；来源开关、顺序和智能模式偏好保存在当前浏览器的 `localStorage`。
- 使用公共数据库时请不要选中敏感文本。

## 范围与已知限制

- **HTML 检索页依赖**：BacDive / LPSN / SeqCode 公开站点没有稳定的免登录 JSON API（BacDive REST API 现需 DSMZ 账号），因此使用公开检索页解析。页面结构变化会让对应库显示为「该库查询失败」，不会影响其他库。
- **GTDB 链接**：卡片展示基因组登录号与 GTDB 谱系，链接指向该物种/属的 GTDB 树页面（`/tree?r=...`）；GTDB 网站没有稳定的单基因组页面路由。
- **SILVA 范围**：只查 SSU（`ssu-144`）参考库；查询词看起来像登录号时使用 accession 字段，否则使用 organism name 字段。
- **SeqCode 总数**：Registry 检索页不提供可靠的命中总数，卡片显示本页条数；其余库显示命中总数。
- **PubMed**：使用 `esummary` 的题录元数据（作者、期刊、年份、综述标记），不返回摘要正文；与 NCBI Protein 共用 350 ms 串行队列。
- **Europe PMC**：使用 `resultType=lite` 的题录信息，不返回摘要；预印本以 `PPR` 记录出现在结果中。
- **OpenAlex**：匿名请求共享当前 IP 的每日免费额度，额度耗尽时该库显示失败而其他库不受影响；有 DOI 时链接 `doi.org`，否则链接 OpenAlex 作品页。
- **智能识别是规则启发式**：DOI/PMID/登录号/序列/物种名由正则与词形判断，英文短语、长单词或混合选区可能被误判；可关闭「智能检索词」或点「按原文重试」。序列识别只用于展示 BLAST 入口，不会把序列自动提交给 BLAST。
- **BLAST 预填受 200 字符选区限制**：超长序列需打开 BLAST 页面后粘贴；UniProt BLAST 只对登录号提供预填，原始序列没有官方 URL 预填接口。
- **单次最多 20 条**：路由每来源取回一页（20 条），UI 在本地按 5/10/20 展示和「再显示」；不做服务端翻页。缓存 TTL 5 分钟且没有手动清缓存按钮，重启宿主即清空；来源开关/顺序保存在当前浏览器 localStorage。
- 结果窗口内容会发送给对应公共服务，请勿在此选中敏感文本。
- NCBI 默认 `protein` 库；`db` 常量可改为 `nucleotide`。
- 不做独立设置页、自动高亮、详情页、翻译或 AI 总结；「问 AI」只把结构化提示插入输入框，不自动发送。
- 主题颜色从 dsh 的 `--dsw-*` 变量读取，读取失败时回退到中性色；面板最小化/展开使用固定尺寸（宽 min(560px, 100vw-28px)，高 min(70vh, 600px)）。

### 扩展一个数据库

1. 在 `src/sources.js` 写一个 `searchXxx(query, options)`，返回 `{ items: [{ id, title, description, url }], total }`；
2. 加进 `SOURCE_DEFINITIONS` 与 `sourceDescriptors()`；
3. 在 `src/analyze.js` 的 `buildSourceQuery` 里按需补该库的语法；
4. 在 `lib/client.js` 的 `INITIAL_SOURCES` 和链接域名白名单里加同一 ID/名称；
5. 在 `test/fixtures.js` 加 fixture，并补解析、路由、缓存与单库模式测试。

## License

MIT
