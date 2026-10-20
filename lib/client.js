/**
 * dsh-multidb-lens — browser half.
 *
 * Plain, no-build JavaScript on purpose. The dsh client-modules protocol loads
 * this file as-is into the page (the same shape used by dsh-plugin-codex-annotate
 * and other DSH client plugins), so a TypeScript build step would only add a
 * compiler and a second React copy without improving the shipped artifact.
 * Types are documented with JSDoc at the few non-obvious boundaries.
 *
 * Responsibilities, and nothing else:
 *   - add "全库搜索" and a hover "单库搜索" submenu next to Copy;
 *   - normalize the selected text (trim, collapse whitespace, cap at 200 chars);
 *   - stream the local host route and forward each event to the result iframe;
 *   - own a fixed-position result window whose entire content is rendered by a
 *     `sandbox="allow-scripts"` iframe with an opaque origin and no host-origin
 *     access;
 *   - validate and open item links through the host page (window.open), never
 *     by navigating inside the iframe.
 *
 * No outbound API request and no API key live here. The browser only talks to
 * the local dsh route implemented by src/index.js.
 */

window.__ModuleLoader__.load({
  id: 'dsh-multidb-lens',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const NS = 'dsh-multidb-lens'
    const PRIMARY_ENDPOINT = '/plugins/dsh-multidb-lens/search'
    const FALLBACK_ENDPOINT = '/api/multidb-lens/search'
    const MAX_QUERY_CHARS = 200
    const CONVERSATION_SELECTOR = '[data-chat-flow], [data-slot="conversation.chat.flow"]'
    const INPUT_SELECTOR = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]'
    const ALLOWED_LINK_HOSTS = new Set([
      'www.ncbi.nlm.nih.gov',
      'ncbi.nlm.nih.gov',
      'www.uniprot.org',
      'uniprot.org',
      'gtdb.ecogenomic.org',
      'bacdive.dsmz.de',
      'www.arb-silva.de',
      'arb-silva.de',
      'lpsn.dsmz.de',
      'seqco.de',
      'registry.seqco.de',
      'pubmed.ncbi.nlm.nih.gov',
      'europepmc.org',
      'doi.org',
      'openalex.org',
      'blast.ncbi.nlm.nih.gov',
    ])

    // Menu metadata is intentionally local: the submenu must render before any
    // request has reached the host. Ids/names are kept in sync with
    // src/sources.js (single-source requests are validated on the host).
    const INITIAL_SOURCES = [
      { id: 'ncbi', name: 'NCBI Protein', subtitle: 'NCBI E-utilities · protein', color: '#2f6fdb' },
      { id: 'uniprot', name: 'UniProtKB', subtitle: 'UniProt REST API', color: '#0b7a75' },
      { id: 'gtdb', name: 'GTDB', subtitle: '基因组分类 · 细菌/古菌', color: '#7a4dd8' },
      { id: 'bacdive', name: 'BacDive', subtitle: 'DSMZ 菌株表型', color: '#c26a00' },
      { id: 'silva', name: 'SILVA', subtitle: 'rRNA 参考序列 · SSU', color: '#2f9e63' },
      { id: 'lpsn', name: 'LPSN', subtitle: '原核生物命名', color: '#b23b6f' },
      { id: 'seqcode', name: 'SeqCode', subtitle: '未培养原核生物命名', color: '#4d6bfe' },
      { id: 'pubmed', name: 'PubMed', subtitle: '生物医学文献', color: '#c53030' },
      { id: 'europepmc', name: 'Europe PMC', subtitle: '生命科学文献 · 预印本', color: '#0b7285' },
      { id: 'openalex', name: 'OpenAlex', subtitle: '开放学术文献索引', color: '#5b6b00' },
    ]

    const PREFS_KEY = 'dsh-multidb-lens:prefs'
    const DEFAULT_SOURCE_IDS = INITIAL_SOURCES.map((source) => source.id)
    const UNIPROT_ACCESSION_PATTERN = /\b(?:[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})\b/u

    const CSS = `
      .dsh-multidb-lens-menu {
        position: fixed;
        z-index: 90;
        box-sizing: border-box;
        width: 196px;
        padding: 5px;
        border-radius: 10px;
        background: var(--dsw-alias-bg-overlay, #ffffff);
        color: var(--dsw-alias-label-primary, #1b1b1f);
        border: 1px solid var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.26));
        box-shadow: 0 14px 36px rgba(0, 0, 0, 0.24);
        font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
        user-select: none;
      }
      .dsh-multidb-lens-menu-item {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        height: 34px;
        padding: 0 10px;
        border: 0;
        border-radius: 7px;
        background: transparent;
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      .dsh-multidb-lens-menu-item:hover,
      .dsh-multidb-lens-menu-item:focus-visible {
        background: var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, 0.12));
        outline: none;
      }
      .dsh-multidb-lens-menu-item svg {
        flex: none;
        opacity: 0.72;
      }
      .dsh-multidb-lens-menu-hint {
        margin-left: auto;
        flex: none;
        max-width: 136px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 10.5px;
        color: var(--dsw-alias-label-tertiary, rgba(127, 127, 127, 0.86));
      }
      .dsh-multidb-lens-chevron {
        margin-left: auto;
        flex: none;
        font-size: 15px;
        line-height: 1;
        opacity: 0.6;
      }
      .dsh-multidb-lens-submenu-wrap { position: relative; }
      .dsh-multidb-lens-submenu {
        position: absolute;
        z-index: 92;
        box-sizing: border-box;
        top: 0;
        width: 292px;
        max-height: calc(100vh - 16px);
        overflow-y: auto;
        padding: 5px;
        border-radius: 10px;
        background: var(--dsw-alias-bg-overlay, #ffffff);
        color: var(--dsw-alias-label-primary, #1b1b1f);
        border: 1px solid var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.26));
        box-shadow: 0 14px 36px rgba(0, 0, 0, 0.24);
      }
      .dsh-multidb-lens-submenu[data-side="right"] { left: calc(100% - 3px); }
      .dsh-multidb-lens-submenu[data-side="left"] { right: calc(100% - 3px); }
      .dsh-multidb-lens-submenu[data-align="bottom"] { top: auto; bottom: 0; }
      .dsh-multidb-lens-submenu-note {
        padding: 4px 8px 6px;
        font-size: 10px;
        line-height: 1.35;
        color: var(--dsw-alias-label-tertiary, rgba(127, 127, 127, 0.86));
        white-space: normal;
      }
      .dsh-multidb-lens-source-row {
        display: flex;
        align-items: center;
        gap: 3px;
        border-radius: 7px;
        padding: 0 2px 0 0;
      }
      .dsh-multidb-lens-source-row:hover,
      .dsh-multidb-lens-source-row:focus-within {
        background: var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, 0.12));
      }
      .dsh-multidb-lens-source-move {
        flex: none;
        display: flex;
        flex-direction: column;
        width: 14px;
        user-select: none;
      }
      .dsh-multidb-lens-source-move-btn {
        width: 14px;
        height: 14px;
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--dsw-alias-label-tertiary, rgba(127, 127, 127, 0.75));
        font: 8px/1 inherit;
        cursor: pointer;
      }
      .dsh-multidb-lens-source-move-btn:hover:not(:disabled) {
        color: var(--dsw-alias-brand-primary, #4d6bfe);
      }
      .dsh-multidb-lens-source-move-btn:disabled { opacity: 0.25; cursor: default; }
      .dsh-multidb-lens-source-move-btn:focus-visible {
        outline: 2px solid var(--dsw-alias-brand-primary, #4d6bfe);
        outline-offset: -1px;
      }
      .dsh-multidb-lens-source-pick { flex: 1 1 auto; min-width: 0; padding-left: 2px; }
      .dsh-multidb-lens-source-pick:hover { background: transparent; }
      .dsh-multidb-lens-source-toggle {
        flex: none;
        width: 24px;
        height: 24px;
        padding: 0;
        border: 1px solid var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.26));
        border-radius: 6px;
        background: transparent;
        color: transparent;
        font: 12px/1 inherit;
        cursor: pointer;
      }
      .dsh-multidb-lens-source-toggle[aria-checked="true"] {
        color: var(--dsw-alias-brand-primary, #4d6bfe);
        border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 46%, transparent);
      }
      .dsh-multidb-lens-source-toggle:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #4d6bfe); outline-offset: 1px; }
      .dsh-multidb-lens-source-dot {
        flex: none;
        width: 7px;
        height: 7px;
        border-radius: 50%;
      }
      .dsh-multidb-lens-toast {
        position: fixed;
        left: 50%;
        bottom: 28px;
        z-index: 100;
        transform: translateX(-50%);
        max-width: min(360px, calc(100vw - 32px));
        padding: 8px 12px;
        border-radius: 8px;
        background: var(--dsw-alias-bg-overlay, #ffffff);
        color: var(--dsw-alias-label-primary, #1b1b1f);
        border: 1px solid var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.26));
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.22);
        font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      }
      .dsh-multidb-lens-window {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 76;
        box-sizing: border-box;
        width: min(560px, calc(100vw - 28px));
        height: min(70vh, 600px);
        border-radius: 14px;
        overflow: hidden;
        background: var(--dsw-alias-bg-overlay, #ffffff);
        border: 1px solid var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.26));
        box-shadow: 0 24px 64px rgba(0, 0, 0, 0.32);
        animation: dsh-multidb-lens-in 140ms ease-out;
        transition: width 140ms ease, height 140ms ease;
      }
      .dsh-multidb-lens-window[data-minimized="true"] {
        width: min(420px, calc(100vw - 28px));
        height: 48px;
      }
      .dsh-multidb-lens-frame {
        display: block;
        width: 100%;
        height: 100%;
        border: 0;
        background: transparent;
      }
      @keyframes dsh-multidb-lens-in {
        from { opacity: 0; transform: translateY(6px) scale(0.995); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      @media (max-width: 640px) {
        .dsh-multidb-lens-window {
          right: 8px;
          bottom: 8px;
          width: calc(100vw - 16px);
          height: min(64vh, 520px);
        }
        .dsh-multidb-lens-window[data-minimized="true"] {
          width: calc(100vw - 16px);
        }
      }
    `

    /**
     * The entire result window content. It is a static local document: no user
     * text is interpolated into the HTML, so API results can only become
     * textContent (or a validated href) after the iframe receives them through
     * postMessage.
     *
     * The iframe is given only `allow-scripts`; it has an opaque origin, no
     * parent DOM access, no cookies/storage, and a CSP that forbids network
     * requests. Links ask the host page to open them.
     */
    const PANEL_HTML = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="light dark">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>检索结果</title>
<style>
  :root {
    --md-bg: #ffffff;
    --md-fg: #1b1b1f;
    --md-muted: #71717a;
    --md-faint: #9a9aa2;
    --md-border: rgba(127, 127, 127, 0.24);
    --md-border-strong: rgba(127, 127, 127, 0.36);
    --md-card: rgba(127, 127, 127, 0.08);
    --md-card-hover: rgba(127, 127, 127, 0.13);
    --md-accent: #4d6bfe;
    --md-danger: #d64545;
    --md-warn: #b7791f;
    --md-success: #2f9e63;
    color-scheme: light dark;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    overflow: hidden;
    background: var(--md-bg);
    color: var(--md-fg);
    font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  #app { height: 100%; }
  .md-window { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .md-header {
    flex: none;
    height: 48px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 8px 0 14px;
    border-bottom: 1px solid var(--md-border);
    background: var(--md-bg);
  }
  .md-head-main { min-width: 0; flex: 1 1 auto; display: flex; flex-direction: column; gap: 1px; }
  .md-title-row { display: flex; align-items: center; gap: 7px; min-width: 0; }
  .md-title { font-size: 13px; font-weight: 650; line-height: 18px; letter-spacing: 0.01em; white-space: nowrap; }
  .md-loading-chip {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0 6px;
    height: 16px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 500;
    color: var(--md-muted);
    border: 1px solid var(--md-border);
  }
  .md-query {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
    line-height: 15px;
    color: var(--md-muted);
  }
  .md-query b { font-weight: 550; color: var(--md-faint); }
  .md-head-actions { flex: none; display: flex; align-items: center; gap: 2px; }
  .md-icon-btn {
    width: 28px;
    height: 28px;
    padding: 0;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--md-muted);
    font: 15px/1 inherit;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .md-icon-btn:hover { background: var(--md-card); color: var(--md-fg); }
  .md-icon-btn:focus-visible { outline: 2px solid var(--md-accent); outline-offset: -1px; }
  .md-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    padding: 10px 12px 12px;
  }
  .md-window[data-minimized="true"] .md-body { display: none; }
  .md-notice {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    flex-wrap: wrap;
    margin: 0 0 8px;
    padding: 7px 9px;
    border-radius: 8px;
    border: 1px solid var(--md-border);
    background: var(--md-card);
    color: var(--md-muted);
    font-size: 11.5px;
    line-height: 1.45;
  }
  .md-notice strong { font-weight: 600; color: var(--md-warn); }
  .md-notice.md-notice-error { border-color: color-mix(in srgb, var(--md-danger) 34%, transparent); }
  .md-notice.md-notice-error strong { color: var(--md-danger); }
  .md-notice span { min-width: 0; overflow-wrap: anywhere; }
  .md-source {
    border: 1px solid var(--md-border);
    border-radius: 10px;
    background: var(--md-card);
    margin: 0 0 10px;
    overflow: hidden;
  }
  .md-source:last-of-type { margin-bottom: 6px; }
  .md-source-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--md-border);
    background: transparent;
  }
  .md-status-dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--md-success);
  }
  .md-status-dot.is-loading { background: transparent; border: 1.5px solid var(--md-border-strong); border-top-color: var(--md-accent); animation: md-spin 700ms linear infinite; }
  .md-status-dot.is-error { background: var(--md-danger); }
  .md-source-name { min-width: 0; flex: 1 1 auto; display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
  .md-source-name b { font-size: 12.5px; font-weight: 650; }
  .md-source-name small { font-size: 10.5px; color: var(--md-faint); }
  .md-source-meta { flex: none; font-size: 10.5px; color: var(--md-muted); white-space: nowrap; }
  .md-source-meta.is-error { color: var(--md-danger); }
  .md-source-body { padding: 8px 10px 9px; }
  .md-card {
    padding: 8px 9px;
    border: 1px solid var(--md-border);
    border-radius: 8px;
    background: var(--md-bg);
    margin: 0 0 6px;
  }
  .md-card:last-child { margin-bottom: 0; }
  .md-card-top { display: flex; align-items: flex-start; gap: 7px; min-width: 0; }
  .md-card-title {
    flex: 1 1 auto;
    min-width: 0;
    margin: 0;
    font-size: 12.5px;
    line-height: 1.38;
    font-weight: 600;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .md-id {
    flex: none;
    max-width: 42%;
    padding: 0 5px;
    border-radius: 4px;
    background: var(--md-card);
    color: var(--md-muted);
    font: 10px/17px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .md-desc {
    margin: 3px 0 0;
    color: var(--md-muted);
    font-size: 11.5px;
    line-height: 1.45;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .md-link-row { margin-top: 5px; }
  .md-link {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: var(--md-accent);
    font-size: 11.5px;
    font-weight: 550;
    text-decoration: none;
    border-radius: 4px;
  }
  .md-link:hover { text-decoration: underline; }
  .md-link:focus-visible { outline: 2px solid var(--md-accent); outline-offset: 2px; }
  .md-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 5px; }
  .md-action {
    padding: 0;
    border: 0;
    background: none;
    color: var(--md-muted);
    font: 11.5px/1.4 inherit;
    cursor: pointer;
    border-radius: 4px;
  }
  .md-action:hover { color: var(--md-accent); text-decoration: underline; }
  .md-action:focus-visible { outline: 2px solid var(--md-accent); outline-offset: 2px; }
  .md-more {
    margin-top: 6px;
    padding: 4px 8px;
    border: 1px solid var(--md-border);
    border-radius: 6px;
    background: transparent;
    color: var(--md-accent);
    font: 11px/1.3 inherit;
    cursor: pointer;
  }
  .md-more:hover { background: var(--md-card-hover); }
  .md-toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 0 8px;
    color: var(--md-muted);
    font-size: 10.5px;
  }
  .md-toolbar select {
    padding: 2px 4px;
    border: 1px solid var(--md-border);
    border-radius: 5px;
    background: var(--md-bg);
    color: var(--md-fg);
    font: inherit;
  }
  .md-notice-action {
    margin-left: auto;
    padding: 0;
    border: 0;
    background: none;
    color: var(--md-accent);
    font: 11px/1.3 inherit;
    cursor: pointer;
    text-decoration: underline;
  }
  .md-loading {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 2px 0;
  }
  .md-skeleton {
    height: 42px;
    border-radius: 7px;
    border: 1px solid var(--md-border);
    background: linear-gradient(90deg, var(--md-card) 20%, var(--md-card-hover) 38%, var(--md-card) 56%);
    background-size: 220% 100%;
    animation: md-shimmer 1.15s ease-in-out infinite;
  }
  .md-skeleton:nth-child(2) { opacity: 0.72; }
  .md-error {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 7px 8px;
    border-radius: 7px;
    border: 1px solid color-mix(in srgb, var(--md-danger) 34%, transparent);
    background: color-mix(in srgb, var(--md-danger) 8%, transparent);
  }
  .md-error strong { font-size: 12px; color: var(--md-danger); font-weight: 600; }
  .md-error span { font-size: 11px; color: var(--md-muted); overflow-wrap: anywhere; }
  .md-empty { padding: 5px 1px; color: var(--md-faint); font-size: 11.5px; }
  .md-foot {
    margin: 8px 0 0;
    text-align: center;
    color: var(--md-faint);
    font-size: 10px;
    line-height: 1.4;
  }
  @keyframes md-spin { to { transform: rotate(360deg); } }
  @keyframes md-shimmer { from { background-position: 120% 0; } to { background-position: -120% 0; } }
  @media (prefers-reduced-motion: reduce) {
    .md-status-dot.is-loading, .md-skeleton { animation: none; }
  }
</style>
</head>
<body>
<div id="app"><div class="md-window"><div class="md-header"><div class="md-head-main"><div class="md-title-row"><span class="md-title">全库检索结果</span></div><div class="md-query">正在准备检索…</div></div></div></div></div>
<script>
(function () {
  'use strict';

  var NS = 'dsh-multidb-lens';
  var MAX_QUERY_CHARS = 200;
  var ALLOWED_HOSTS = {
    'www.ncbi.nlm.nih.gov': 1,
    'ncbi.nlm.nih.gov': 1,
    'www.uniprot.org': 1,
    'uniprot.org': 1,
    'gtdb.ecogenomic.org': 1,
    'bacdive.dsmz.de': 1,
    'www.arb-silva.de': 1,
    'arb-silva.de': 1,
    'lpsn.dsmz.de': 1,
    'seqco.de': 1,
    'registry.seqco.de': 1,
    'pubmed.ncbi.nlm.nih.gov': 1,
    'europepmc.org': 1,
    'doi.org': 1,
    'openalex.org': 1,
    'blast.ncbi.nlm.nih.gov': 1
  };
  var state = null;
  var lastRequestId = null;
  var pageSize = 5;
  var visibleCounts = {};
  var root = document.getElementById('app');

  function send(type, payload) {
    var message = { ns: NS, type: type };
    if (payload) {
      for (var key in payload) {
        if (Object.prototype.hasOwnProperty.call(payload, key)) message[key] = payload[key];
      }
    }
    parent.postMessage(message, '*');
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function safeUrl(value) {
    if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return null;
    try {
      var url = new URL(value);
      if (url.protocol !== 'https:') return null;
      if (url.port !== '') return null;
      if (!ALLOWED_HOSTS[url.hostname.toLowerCase()]) return null;
      if (url.username !== '' || url.password !== '') return null;
      return url.href;
    } catch (error) {
      return null;
    }
  }

  function countText(value) {
    if (typeof value !== 'number' || !isFinite(value) || value < 0) return '';
    try { return value.toLocaleString('zh-CN'); } catch (error) { return String(value); }
  }

  function statusOf(source) {
    if (source && source.status === 'error') return 'error';
    if (source && source.status === 'ok') return 'ok';
    return 'loading';
  }

  function sourceResultText(source, shown) {
    var status = statusOf(source);
    if (status === 'loading') return '检索中…';
    if (status === 'error') return '失败';
    var count = typeof shown === 'number' ? shown : (Array.isArray(source.items) ? source.items.length : 0);
    var total = typeof source.total === 'number' && isFinite(source.total) ? source.total : null;
    var suffix = source.cached ? ' · 缓存' : '';
    if (total !== null && total > count) return '共 ' + countText(total) + ' 条 · 显示 ' + count + ' 条' + suffix;
    if (typeof source.elapsedMs === 'number') return count + ' 条 · ' + (source.elapsedMs / 1000).toFixed(1) + 's' + suffix;
    return count + ' 条' + suffix;
  }

  function applyTheme(theme) {
    if (!theme || typeof theme !== 'object') return;
    var map = {
      bg: '--md-bg', fg: '--md-fg', muted: '--md-muted', faint: '--md-faint',
      border: '--md-border', borderStrong: '--md-border-strong', card: '--md-card',
      cardHover: '--md-card-hover', accent: '--md-accent', danger: '--md-danger', warn: '--md-warn'
    };
    for (var key in map) {
      if (Object.prototype.hasOwnProperty.call(map, key) && typeof theme[key] === 'string' && theme[key] !== '') {
        document.documentElement.style.setProperty(map[key], theme[key]);
      }
    }
  }

  function panelTitle() {
    return state && state.mode === 'single' ? '单库检索结果' : '全库检索结果';
  }

  function buildHeader() {
    var minimized = !!(state && state.minimized);
    var header = el('div', 'md-header');
    var main = el('div', 'md-head-main');
    var titleRow = el('div', 'md-title-row');
    titleRow.appendChild(el('span', 'md-title', panelTitle()));
    var loading = !state || (state.sources || []).some(function (source) { return statusOf(source) === 'loading'; });
    if (loading) {
      var chip = el('span', 'md-loading-chip');
      var dot = el('span', 'md-status-dot is-loading');
      dot.style.width = '7px';
      dot.style.height = '7px';
      chip.appendChild(dot);
      chip.appendChild(el('span', null, '检索中'));
      titleRow.appendChild(chip);
    }
    main.appendChild(titleRow);
    var query = state && typeof state.query === 'string' && state.query !== '' ? state.query : '（无检索词）';
    var queryLine = el('div', 'md-query');
    queryLine.title = query;
    queryLine.appendChild(el('b', null, '检索词 '));
    queryLine.appendChild(document.createTextNode(query));
    main.appendChild(queryLine);
    header.appendChild(main);

    var actions = el('div', 'md-head-actions');
    var toggle = el('button', 'md-icon-btn', minimized ? '▢' : '—');
    toggle.type = 'button';
    toggle.setAttribute('data-action', minimized ? 'restore' : 'minimize');
    toggle.setAttribute('aria-label', minimized ? '展开结果窗口' : '最小化结果窗口');
    toggle.title = minimized ? '展开' : '最小化';
    actions.appendChild(toggle);
    var close = el('button', 'md-icon-btn', '×');
    close.type = 'button';
    close.setAttribute('data-action', 'close');
    close.setAttribute('aria-label', '关闭检索结果');
    close.title = '关闭';
    actions.appendChild(close);
    header.appendChild(actions);
    return header;
  }

  function buildNotice(kind, title, detail) {
    var notice = el('div', 'md-notice' + (kind === 'error' ? ' md-notice-error' : ''));
    notice.appendChild(el('strong', null, title));
    if (detail) notice.appendChild(el('span', null, detail));
    return notice;
  }

  function buildLink(source, item) {
    var url = safeUrl(item.url);
    if (url === null) return null;
    var link = el('a', 'md-link', '打开条目 ↗');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.setAttribute('data-action', 'open-link');
    link.setAttribute('data-url', url);
    link.title = url;
    return link;
  }

  function citationFor(source, item) {
    var lines = [];
    if (item.title) lines.push(item.title);
    if (item.description) lines.push(item.description);
    if (item.id) lines.push('ID: ' + item.id);
    if (item.url) lines.push(item.url);
    return lines.join('\n');
  }

  function aiPromptFor(source, item) {
    var lines = ['请基于以下条目继续分析：', '来源：' + (source.name || source.id || '数据库')];
    if (item.title) lines.push('标题：' + item.title);
    if (item.id) lines.push('ID：' + item.id);
    if (item.description) lines.push('描述：' + item.description);
    if (item.url) lines.push('链接：' + item.url);
    return lines.join('\n');
  }

  function buildAction(label, action, text) {
    var button = el('button', 'md-action', label);
    button.type = 'button';
    button.setAttribute('data-action', action);
    button.setAttribute('data-text', String(text).slice(0, 2000));
    return button;
  }

  function buildCard(source, item) {
    var card = el('article', 'md-card');
    var top = el('div', 'md-card-top');
    var title = el('h3', 'md-card-title', item.title || item.id || '未命名条目');
    title.title = item.title || '';
    top.appendChild(title);
    if (item.id) {
      var id = el('span', 'md-id', item.id);
      id.title = item.id;
      top.appendChild(id);
    }
    card.appendChild(top);
    if (item.description) card.appendChild(el('p', 'md-desc', item.description));

    var actions = el('div', 'md-actions');
    var link = buildLink(source, item);
    if (link !== null) actions.appendChild(link);
    var citation = citationFor(source, item);
    if (item.id) actions.appendChild(buildAction('复制 ID', 'copy-text', item.id));
    actions.appendChild(buildAction('复制引文', 'copy-text', citation));
    actions.appendChild(buildAction('插入输入框', 'insert-text', citation));
    actions.appendChild(buildAction('问 AI', 'insert-text', aiPromptFor(source, item)));
    card.appendChild(actions);
    return card;
  }

  function buildLoading() {
    var box = el('div', 'md-loading');
    box.setAttribute('aria-hidden', 'true');
    box.appendChild(el('div', 'md-skeleton'));
    box.appendChild(el('div', 'md-skeleton'));
    return box;
  }

  function buildSource(source) {
    var status = statusOf(source);
    var items = Array.isArray(source.items) ? source.items : [];
    var visible = typeof visibleCounts[source.id] === 'number' ? visibleCounts[source.id] : pageSize;
    var shown = Math.min(items.length, visible);
    var section = el('section', 'md-source');
    var head = el('div', 'md-source-head');
    var dot = el('span', 'md-status-dot' + (status === 'loading' ? ' is-loading' : status === 'error' ? ' is-error' : ''));
    head.appendChild(dot);
    var name = el('div', 'md-source-name');
    name.appendChild(el('b', null, source.name || source.id || '数据库'));
    if (source.subtitle) name.appendChild(el('small', null, source.subtitle));
    head.appendChild(name);
    var meta = el('span', 'md-source-meta' + (status === 'error' ? ' is-error' : ''), sourceResultText(source, shown));
    head.appendChild(meta);
    section.appendChild(head);

    var body = el('div', 'md-source-body');
    if (status === 'loading') {
      body.setAttribute('aria-busy', 'true');
      body.appendChild(buildLoading());
    } else if (status === 'error') {
      var error = source.error || {};
      var message = typeof error.message === 'string' && error.message !== '' ? error.message : '该库查询失败';
      if (error.code === 'timeout') message = '该库查询超时';
      var detail = typeof error.detail === 'string' ? error.detail : '';
      var errorBox = el('div', 'md-error');
      errorBox.setAttribute('role', 'alert');
      errorBox.appendChild(el('strong', null, message));
      if (detail) errorBox.appendChild(el('span', null, detail));
      body.appendChild(errorBox);
    } else {
      if (items.length === 0) {
        body.appendChild(el('div', 'md-empty', '未找到匹配条目'));
      } else {
        var list = el('div', 'md-card-list');
        for (var i = 0; i < shown; i += 1) list.appendChild(buildCard(source, items[i]));
        body.appendChild(list);
        if (shown < items.length) {
          var more = el('button', 'md-more', '再显示 ' + Math.min(pageSize, items.length - shown) + ' 条');
          more.type = 'button';
          more.setAttribute('data-action', 'more');
          more.setAttribute('data-source', source.id);
          body.appendChild(more);
        } else {
          var total = typeof source.total === 'number' && isFinite(source.total) ? source.total : null;
          if (total !== null && total > items.length) {
            body.appendChild(el('div', 'md-empty', '已取回 ' + items.length + ' 条（共 ' + countText(total) + ' 条）'));
          }
        }
      }
    }
    section.appendChild(body);
    return section;
  }

  function buildToolbar() {
    var toolbar = el('div', 'md-toolbar');
    toolbar.appendChild(el('span', null, '每库显示'));
    var select = el('select');
    select.setAttribute('data-action', 'page-size');
    select.setAttribute('aria-label', '每库显示条数');
    [5, 10, 20].forEach(function (size) {
      var option = el('option', null, String(size));
      option.value = String(size);
      if (size === pageSize) option.selected = true;
      select.appendChild(option);
    });
    toolbar.appendChild(select);
    toolbar.appendChild(el('span', null, '条（单次最多取回 20 条）'));
    return toolbar;
  }

  function buildQueryNotice() {
    if (!state || typeof state.queryKind !== 'string' || state.queryKind === 'text') return null;
    var adaptive = state.adaptive !== false;
    var label = typeof state.queryLabel === 'string' && state.queryLabel !== '' ? state.queryLabel : '实体';
    var value = typeof state.detectedValue === 'string' ? state.detectedValue : '';
    var shownValue = value.length > 46 ? value.slice(0, 45) + '…' : value;
    var detail = '已识别为 ' + label + (shownValue === '' ? '' : '：' + shownValue)
      + (adaptive ? '，各库按自身语法查询。' : '；当前按原文发送。');
    var notice = buildNotice('', adaptive ? '智能检索' : '原文检索', detail);
    var button = el('button', 'md-notice-action', adaptive ? '按原文重试' : '智能检索');
    button.type = 'button';
    button.setAttribute('data-action', 'retry-query');
    button.setAttribute('data-adaptive', adaptive ? 'false' : 'true');
    notice.appendChild(button);
    return notice;
  }

  function buildWindow() {
    var windowNode = el('div', 'md-window');
    if (state && state.minimized) windowNode.setAttribute('data-minimized', 'true');
    windowNode.appendChild(buildHeader());
    if (!state || !state.minimized) {
      var body = el('div', 'md-body');
      body.id = 'md-body';
      body.appendChild(buildToolbar());
      if (state && state.globalError) {
        body.appendChild(buildNotice('error', '检索服务异常', state.globalError));
      }
      if (state && state.truncated) {
        body.appendChild(buildNotice('warn', '检索词已截断', '仅使用前 ' + MAX_QUERY_CHARS + ' 个字符进行检索。'));
      }
      var queryNotice = buildQueryNotice();
      if (queryNotice !== null) body.appendChild(queryNotice);
      var sources = state && Array.isArray(state.sources) ? state.sources : [];
      for (var i = 0; i < sources.length; i += 1) body.appendChild(buildSource(sources[i]));
      var modeText = state && state.mode === 'single' ? '单库检索' : '全库检索';
      var foot = el('p', 'md-foot', '划词多库透镜 · ' + modeText + ' · 链接在浏览器中打开');
      body.appendChild(foot);
      windowNode.appendChild(body);
    }
    return windowNode;
  }

  function render() {
    var previousBody = document.getElementById('md-body');
    var previousScroll = previousBody === null ? 0 : previousBody.scrollTop;
    var nextRequestId = state && state.requestId !== undefined ? state.requestId : null;
    var requestChanged = nextRequestId !== lastRequestId;
    if (requestChanged) {
      lastRequestId = nextRequestId;
      previousScroll = 0;
    }
    root.replaceChildren(buildWindow());
    var nextBody = document.getElementById('md-body');
    if (nextBody !== null) nextBody.scrollTop = requestChanged ? 0 : previousScroll;
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return;
    var data = event.data;
    if (data === null || typeof data !== 'object' || data.ns !== NS) return;
    if (data.type === 'init' || data.type === 'state') {
      var incoming = data.state && typeof data.state === 'object' ? data.state : null;
      if (state === null || incoming === null || incoming.requestId !== state.requestId) {
        visibleCounts = {};
      }
      state = incoming;
      applyTheme(data.theme);
      render();
    }
  });

  document.addEventListener('click', function (event) {
    var target = event.target instanceof Element ? event.target : null;
    if (target === null) return;
    var action = target.closest('[data-action]');
    if (action === null) return;
    var name = action.getAttribute('data-action');
    if (name === 'close') {
      event.preventDefault();
      send('close');
    } else if (name === 'minimize') {
      event.preventDefault();
      send('minimize');
    } else if (name === 'restore') {
      event.preventDefault();
      send('restore');
    } else if (name === 'open-link') {
      event.preventDefault();
      var url = safeUrl(action.getAttribute('data-url'));
      if (url !== null) send('open-link', { url: url });
    } else if (name === 'copy-text' || name === 'insert-text') {
      event.preventDefault();
      var text = action.getAttribute('data-text') || '';
      if (text !== '') send(name, { text: text });
    } else if (name === 'retry-query') {
      event.preventDefault();
      send('retry-query', { adaptive: action.getAttribute('data-adaptive') === 'true' });
    } else if (name === 'more') {
      event.preventDefault();
      var sourceId = action.getAttribute('data-source');
      if (sourceId !== null && sourceId !== '') {
        visibleCounts[sourceId] = (visibleCounts[sourceId] || pageSize) + pageSize;
        render();
      }
    }
  });

  document.addEventListener('change', function (event) {
    var target = event.target instanceof Element ? event.target : null;
    if (target === null || target.getAttribute('data-action') !== 'page-size') return;
    var next = Number(target.value);
    if (next !== 5 && next !== 10 && next !== 20) return;
    pageSize = next;
    visibleCounts = {};
    render();
  });

  document.addEventListener('auxclick', function (event) {
    if (event.button !== 1) return;
    var target = event.target instanceof Element ? event.target : null;
    if (target === null) return;
    var link = target.closest('[data-action="open-link"]');
    if (link === null) return;
    event.preventDefault();
    var url = safeUrl(link.getAttribute('data-url'));
    if (url !== null) send('open-link', { url: url });
  });

  render();
  send('ready');
})();
</script>
</body>
</html>`

    // ── parent-side helpers ───────────────────────────────────────────────────

    function clamp(value, min, max) {
      return Math.min(Math.max(value, min), max)
    }

    function elementOf(node) {
      if (node === null || node === undefined) return null
      return node.nodeType === 1 ? node : node.parentElement
    }

    /**
     * Mirror of the host's normalizeSelection. Kept identical so the menu/panel
     * can react immediately; the host re-normalizes the payload regardless.
     * @param {string} raw
     */
    function normalizeSelectionText(raw) {
      const collapsed = String(raw).replace(/\s+/gu, ' ').trim()
      const points = Array.from(collapsed)
      return {
        text: points.slice(0, MAX_QUERY_CHARS).join(''),
        truncated: points.length > MAX_QUERY_CHARS,
        length: points.length,
      }
    }

    function sanitizeIncomingText(value) {
      if (typeof value !== 'string') return ''
      const text = value.trim()
      return text === '' ? '' : text.slice(0, 4000)
    }

    function safeExternalUrl(value) {
      if (typeof value !== 'string' || value === '' || value.length > 2048) return null
      try {
        const url = new URL(value)
        if (url.protocol !== 'https:') return null
        if (url.port !== '') return null
        if (url.username !== '' || url.password !== '') return null
        if (!ALLOWED_LINK_HOSTS.has(url.hostname.toLowerCase())) return null
        return url.href
      } catch {
        return null
      }
    }

    function defaultPrefs() {
      return {
        order: [...DEFAULT_SOURCE_IDS],
        enabled: [...DEFAULT_SOURCE_IDS],
        smart: true,
      }
    }

    function loadPrefs() {
      try {
        const raw = localStorage.getItem(PREFS_KEY)
        if (raw === null) return defaultPrefs()
        const parsed = JSON.parse(raw)
        const known = new Set(DEFAULT_SOURCE_IDS)
        const order = []
        for (const id of Array.isArray(parsed?.order) ? parsed.order : []) {
          if (typeof id === 'string' && known.has(id) && !order.includes(id)) order.push(id)
        }
        for (const id of DEFAULT_SOURCE_IDS) {
          if (!order.includes(id)) order.push(id)
        }
        const enabled = []
        for (const id of Array.isArray(parsed?.enabled) ? parsed.enabled : DEFAULT_SOURCE_IDS) {
          if (typeof id === 'string' && known.has(id) && !enabled.includes(id)) enabled.push(id)
        }
        return { order, enabled, smart: parsed?.smart !== false }
      } catch {
        return defaultPrefs()
      }
    }

    function savePrefs(prefs) {
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
      } catch {
        // Preferences are a convenience; private mode may reject storage.
      }
    }

    function sourceCatalog(order) {
      return order
        .map((id) => INITIAL_SOURCES.find((source) => source.id === id))
        .filter((source) => source !== undefined)
    }

    function detectBlastTarget(text) {
      const withoutHeaders = String(text)
        .split(/\r?\n/u)
        .filter((line) => !line.trim().startsWith('>'))
        .join('')
      const compact = withoutHeaders.replace(/\s+/gu, '')
      if (compact.length < 20) return null
      if (/\s/u.test(withoutHeaders.trim()) && /[a-z]/u.test(compact)) return null
      if (/^[ACGTUN]+$/iu.test(compact)) return { type: 'dna', query: compact }
      const distinct = new Set(compact.toUpperCase())
      if (/^[ACDEFGHIKLMNPQRSTVWYBXZJUO*]+$/iu.test(compact) && distinct.size >= 10) {
        return { type: 'protein', query: compact }
      }
      return null
    }

    function detectBlastAccession(text) {
      const match = UNIPROT_ACCESSION_PATTERN.exec(String(text))
      return match === null ? '' : match[0]
    }

    function ncbiBlastUrl(target, accession) {
      const program = target === null ? 'blastp' : target.type === 'dna' ? 'blastn' : 'blastp'
      const query = target === null ? accession : target.query
      return `https://blast.ncbi.nlm.nih.gov/Blast.cgi?PROGRAM=${program}&PAGE_TYPE=BlastSearch&LINK_LOC=blasthome&QUERY=${encodeURIComponent(query)}`
    }

    function uniprotBlastUrl(accession) {
      return `https://www.uniprot.org/blast/?about=${encodeURIComponent(accession)}`
    }

    function placeMenu(x, y, itemCount = 4) {
      const width = 196
      const height = 10 + itemCount * 34
      return {
        top: `${clamp(y, 8, Math.max(8, window.innerHeight - height - 8))}px`,
        left: `${clamp(x, 8, Math.max(8, window.innerWidth - width - 8))}px`,
      }
    }

    function copyIcon() {
      return h('svg', {
        viewBox: '0 0 16 16',
        width: 14,
        height: 14,
        'aria-hidden': true,
        style: { flex: 'none', display: 'block' },
      },
      h('path', {
        d: 'M5.5 2h5A1.5 1.5 0 0 1 12 3.5v7a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 4 10.5v-7A1.5 1.5 0 0 1 5.5 2Zm0 1.2a.3.3 0 0 0-.3.3v7c0 .17.13.3.3.3h5a.3.3 0 0 0 .3-.3v-7a.3.3 0 0 0-.3-.3h-5Z',
        fill: 'currentColor',
      }),
      h('path', {
        d: 'M2.6 4.6h1.2v7.6c0 .35.28.63.63.63h4.9v1.2h-4.9A1.83 1.83 0 0 1 2.6 12.2V4.6Z',
        fill: 'currentColor',
      }))
    }

    function smartIcon() {
      return h('svg', {
        viewBox: '0 0 16 16',
        width: 14,
        height: 14,
        'aria-hidden': true,
        style: { flex: 'none', display: 'block' },
      },
      h('path', {
        d: 'M8 1.6l1.25 4.15L13.4 7l-4.15 1.25L8 12.4 6.75 8.25 2.6 7l4.15-1.25L8 1.6Z',
        fill: 'currentColor',
      }))
    }

    function blastIcon() {
      return h('svg', {
        viewBox: '0 0 16 16',
        width: 14,
        height: 14,
        'aria-hidden': true,
        style: { flex: 'none', display: 'block' },
      },
      h('path', {
        d: 'M2 3.2h7v1.2H2V3.2Zm0 4.2h11v1.2H2V7.4Zm0 4.2h5v1.2H2v-1.2Z',
        fill: 'currentColor',
      }))
    }

    function sourceDot(color) {
      return h('span', {
        className: 'dsh-multidb-lens-source-dot',
        'aria-hidden': true,
        style: { backgroundColor: typeof color === 'string' && color !== '' ? color : 'currentColor' },
      })
    }

    function lensIcon() {
      return h('svg', {
        viewBox: '0 0 16 16',
        width: 14,
        height: 14,
        'aria-hidden': true,
        style: { flex: 'none', display: 'block' },
      },
      h('circle', {
        cx: 6.9,
        cy: 6.9,
        r: 4.2,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.4,
      }),
      h('path', {
        d: 'm10.1 10.1 3.8 3.8',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinecap: 'round',
      }),
      h('path', {
        d: 'M4.8 8.9V4.9m1.8 4V4.9m1.8 4V4.9',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.1,
        strokeLinecap: 'round',
        opacity: 0.8,
      }))
    }

    function fallbackCopy(text) {
      try {
        const area = document.createElement('textarea')
        area.value = text
        area.setAttribute('readonly', '')
        area.style.position = 'fixed'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        document.execCommand('copy')
        document.body.removeChild(area)
      } catch {
        // Clipboard unavailable; nothing else to try.
      }
    }

    function blankSource(descriptor) {
      return {
        id: descriptor.id,
        name: typeof descriptor.name === 'string' ? descriptor.name : descriptor.id,
        subtitle: typeof descriptor.subtitle === 'string' ? descriptor.subtitle : '',
        status: 'loading',
        items: [],
        total: null,
        error: null,
        elapsedMs: null,
      }
    }

    function initialSources() {
      return INITIAL_SOURCES.map((source) => blankSource(source))
    }

    function normalizeError(raw) {
      if (raw === null || typeof raw !== 'object') {
        return { code: 'unknown', message: '该库查询失败', detail: '未知错误' }
      }
      return {
        code: typeof raw.code === 'string' ? raw.code : 'unknown',
        message: typeof raw.message === 'string' && raw.message !== '' ? raw.message : '该库查询失败',
        detail: typeof raw.detail === 'string' ? raw.detail : '',
      }
    }

    function applySourceEvent(source, event) {
      const elapsedMs = typeof event.elapsedMs === 'number' && Number.isFinite(event.elapsedMs)
        ? event.elapsedMs
        : null
      if (event.status === 'ok') {
        const items = Array.isArray(event.items)
          ? event.items.filter((item) => item !== null && typeof item === 'object')
          : []
        return {
          ...source,
          status: 'ok',
          items,
          total: typeof event.total === 'number' && Number.isFinite(event.total) ? event.total : null,
          error: null,
          elapsedMs,
          cached: event.cached === true,
        }
      }
      return {
        ...source,
        status: 'error',
        items: [],
        total: null,
        error: normalizeError(event.error),
        elapsedMs,
      }
    }

    function mergeSourceDescriptors(current, descriptors) {
      if (!Array.isArray(descriptors) || descriptors.length === 0) return current
      const byId = new Map()
      for (const descriptor of descriptors) {
        if (descriptor === null || typeof descriptor !== 'object' || typeof descriptor.id !== 'string') continue
        byId.set(descriptor.id, descriptor)
      }
      if (byId.size === 0) return current
      // Keep the user's drag order: descriptors only refresh metadata and add
      // sources the current request did not know about.
      const next = current
        .filter((source) => byId.has(source.id))
        .map((source) => {
          const descriptor = byId.get(source.id)
          return {
            ...source,
            name: typeof descriptor.name === 'string' && descriptor.name !== '' ? descriptor.name : source.name,
            subtitle: typeof descriptor.subtitle === 'string' && descriptor.subtitle !== ''
              ? descriptor.subtitle
              : source.subtitle,
          }
        })
      for (const descriptor of descriptors) {
        if (typeof descriptor?.id !== 'string' || next.some((source) => source.id === descriptor.id)) continue
        next.push(blankSource(descriptor))
      }
      return next
    }

    function readThemeVar(container, name) {
      if (container === null || container === undefined) return ''
      try {
        const value = getComputedStyle(container).getPropertyValue(name).trim()
        return /^(#|rgb|hsl|oklch|lab|lch|color\()/iu.test(value) ? value : ''
      } catch {
        return ''
      }
    }

    /**
     * Resolve a few dsh theme colors for the sandboxed document. Custom
     * properties are inherited by the wrapper inside the themed tree; values
     * that are still var() references are rejected and fall back to computed
     * body colors / neutral defaults.
     */
    function readTheme(container) {
      const theme = {
        bg: '#ffffff',
        fg: '#1b1b1f',
        muted: '#71717a',
        faint: '#9a9aa2',
        border: 'rgba(127, 127, 127, 0.24)',
        borderStrong: 'rgba(127, 127, 127, 0.36)',
        card: 'rgba(127, 127, 127, 0.08)',
        cardHover: 'rgba(127, 127, 127, 0.13)',
        accent: '#4d6bfe',
        danger: '#d64545',
        warn: '#b7791f',
      }
      try {
        const bodyStyle = getComputedStyle(document.body)
        const bodyBg = bodyStyle.backgroundColor
        const bodyFg = bodyStyle.color
        if (typeof bodyBg === 'string' && bodyBg !== '' && bodyBg !== 'transparent'
          && bodyBg !== 'rgba(0, 0, 0, 0)') theme.bg = bodyBg
        if (typeof bodyFg === 'string' && bodyFg !== '') theme.fg = bodyFg
      } catch {
        // use defaults
      }
      theme.bg = readThemeVar(container, '--dsw-alias-bg-overlay')
        || readThemeVar(container, '--dsw-alias-bg-layer-1')
        || theme.bg
      theme.fg = readThemeVar(container, '--dsw-alias-label-primary') || theme.fg
      theme.muted = readThemeVar(container, '--dsw-alias-label-secondary') || theme.muted
      theme.faint = readThemeVar(container, '--dsw-alias-label-tertiary') || theme.faint
      theme.border = readThemeVar(container, '--dsw-alias-border-l1') || theme.border
      theme.borderStrong = readThemeVar(container, '--dsw-alias-border-l2') || theme.borderStrong
      theme.card = readThemeVar(container, '--dsw-alias-bg-layer-2') || theme.card
      theme.accent = readThemeVar(container, '--dsw-alias-brand-primary') || theme.accent
      theme.danger = readThemeVar(container, '--dsw-alias-state-error-primary') || theme.danger
      theme.warn = readThemeVar(container, '--dsw-alias-state-warn-primary') || theme.warn
      return theme
    }

    // ── overlay component ─────────────────────────────────────────────────────

    function LensOverlay() {
      const [menu, setMenu] = React.useState(null)
      const [panel, setPanel] = React.useState(null)
      const [frameReady, setFrameReady] = React.useState(false)
      const [submenuOpen, setSubmenuOpen] = React.useState(false)
      const [blastOpen, setBlastOpen] = React.useState(false)
      const [prefs, setPrefs] = React.useState(loadPrefs)
      const [toast, setToast] = React.useState(null)
      const menuRef = React.useRef(null)
      const firstMenuItemRef = React.useRef(null)
      const singleItemRef = React.useRef(null)
      const firstSubItemRef = React.useRef(null)
      const focusSubmenuRef = React.useRef(false)
      const blastItemRef = React.useRef(null)
      const firstBlastItemRef = React.useRef(null)
      const focusBlastRef = React.useRef(false)
      const toastTimerRef = React.useRef(null)
      const iframeRef = React.useRef(null)
      const windowRef = React.useRef(null)
      const abortRef = React.useRef(null)
      const requestSeqRef = React.useRef(0)
      const initializedRef = React.useRef(false)
      const panelRef = React.useRef(panel)
      panelRef.current = panel

      const ordered = sourceCatalog(prefs.order)
      const enabledSet = new Set(prefs.enabled)
      const enabledIds = ordered.filter((source) => enabledSet.has(source.id)).map((source) => source.id)

      React.useEffect(() => {
        savePrefs(prefs)
      }, [prefs])

      const showToast = React.useCallback((message) => {
        if (typeof message !== 'string' || message === '') return
        setToast(message)
        if (toastTimerRef.current !== null) clearTimeout(toastTimerRef.current)
        toastTimerRef.current = setTimeout(() => {
          toastTimerRef.current = null
          setToast(null)
        }, 1800)
      }, [])

      const toggleSource = React.useCallback((id) => {
        setPrefs((current) => ({
          ...current,
          enabled: current.enabled.includes(id)
            ? current.enabled.filter((sourceId) => sourceId !== id)
            : [...current.enabled, id],
        }))
      }, [])

      const moveSourceBy = React.useCallback((id, delta) => {
        setPrefs((current) => {
          const order = [...current.order]
          const index = order.indexOf(id)
          const target = index + delta
          if (index < 0 || target < 0 || target >= order.length) return current
          order.splice(index, 1)
          order.splice(target, 0, id)
          return { ...current, order }
        })
      }, [])

      const closePanel = React.useCallback(() => {
        abortRef.current?.abort()
        abortRef.current = null
        initializedRef.current = false
        setFrameReady(false)
        setPanel(null)
      }, [])

      const postToFrame = React.useCallback((message) => {
        const win = iframeRef.current?.contentWindow
        if (win === null || win === undefined) return
        // The sandboxed frame has an opaque origin, so targetOrigin must be '*'.
        try {
          win.postMessage({ ns: NS, ...message }, '*')
        } catch {
          // frame already gone
        }
      }, [])

      const updatePanel = React.useCallback((requestId, updater) => {
        setPanel((current) => {
          if (current === null || current.requestId !== requestId) return current
          return updater(current)
        })
      }, [])

      const handleEvent = React.useCallback((event, requestId) => {
        if (event === null || typeof event !== 'object') return
        if (event.type === 'meta') {
          updatePanel(requestId, (current) => {
            const mode = event.mode === 'single' ? 'single' : event.mode === 'all' ? 'all' : current.mode
            const sourceId = typeof event.sourceId === 'string'
              ? event.sourceId
              : (mode === 'all' ? null : current.sourceId)
            return {
              ...current,
              mode,
              sourceId,
              adaptive: event.adaptive !== false,
              queryKind: typeof event.queryKind === 'string' ? event.queryKind : current.queryKind,
              queryLabel: typeof event.queryLabel === 'string' ? event.queryLabel : current.queryLabel,
              detectedValue: typeof event.detectedValue === 'string' ? event.detectedValue : current.detectedValue,
              sequenceType: typeof event.sequenceType === 'string' ? event.sequenceType : current.sequenceType,
              query: typeof event.query === 'string' && event.query !== '' ? event.query : current.query,
              truncated: event.truncated === true || current.truncated,
              sources: mergeSourceDescriptors(current.sources, event.sources),
            }
          })
          return
        }
        if (event.type === 'source') {
          updatePanel(requestId, (current) => ({
            ...current,
            sources: current.sources.map((source) => (
              source.id === event.id ? applySourceEvent(source, event) : source
            )),
          }))
          return
        }
        if (event.type === 'fatal') {
          const message = typeof event.error?.message === 'string' && event.error.message !== ''
            ? event.error.message
            : '检索聚合异常'
          updatePanel(requestId, (current) => ({
            ...current,
            globalError: message,
            sources: current.sources.map((source) => (
              source.status === 'loading'
                ? {
                    ...source,
                    status: 'error',
                    error: { code: 'fatal', message: '该库查询失败', detail: message },
                  }
                : source
            )),
          }))
        }
      }, [updatePanel])

      const consumeNdjson = React.useCallback(async (response, requestId) => {
        if (response.body === null || response.body === undefined) {
          throw new Error('本地检索服务未返回响应体')
        }
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let sawDone = false

        const processLine = (line) => {
          if (line.trim() === '') return
          let event
          try {
            event = JSON.parse(line)
          } catch {
            throw new Error('检索服务返回了无法解析的数据')
          }
          handleEvent(event, requestId)
          if (event?.type === 'done') sawDone = true
        }

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let newline = buffer.indexOf('\n')
          while (newline >= 0) {
            const line = buffer.slice(0, newline)
            buffer = buffer.slice(newline + 1)
            processLine(line)
            newline = buffer.indexOf('\n')
          }
        }
        buffer += decoder.decode()
        if (buffer.trim() !== '') processLine(buffer)

        if (!sawDone) {
          updatePanel(requestId, (current) => ({
            ...current,
            globalError: current.globalError === '' ? '检索服务提前结束' : current.globalError,
            sources: current.sources.map((source) => (
              source.status === 'loading'
                ? {
                    ...source,
                    status: 'error',
                    error: { code: 'incomplete', message: '该库查询失败', detail: '检索服务提前结束' },
                  }
                : source
            )),
          }))
        }
      }, [handleEvent, updatePanel])

      const runSearch = React.useCallback(async (requestId, requestBody, signal) => {
        try {
          /** @type {Response | null} */
          let response = null
          for (const endpoint of [PRIMARY_ENDPOINT, FALLBACK_ENDPOINT]) {
            response = await fetch(endpoint, {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                accept: 'application/x-ndjson',
              },
              body: JSON.stringify(requestBody),
              credentials: 'same-origin',
              cache: 'no-store',
              signal,
            })
            if (response.status !== 404 && response.status !== 405) break
            try {
              await response.body?.cancel()
            } catch {
              // ignore
            }
          }
          if (response === null) throw new Error('无法连接本地检索服务')
          if (!response.ok) {
            let message = `本地检索服务不可用（HTTP ${response.status}）`
            try {
              const text = await response.text()
              const parsed = JSON.parse(text)
              if (typeof parsed?.error === 'string' && parsed.error !== '') message = parsed.error
            } catch {
              // keep the HTTP message
            }
            throw new Error(message)
          }
          const contentType = response.headers.get('content-type') ?? ''
          if (!contentType.includes('ndjson')) {
            let message = '本地检索服务返回了不支持的响应格式'
            try {
              const parsed = await response.json()
              if (typeof parsed?.error === 'string' && parsed.error !== '') message = parsed.error
            } catch {
              // keep the format message
            }
            throw new Error(message)
          }
          await consumeNdjson(response, requestId)
        } catch (error) {
          if (signal.aborted || error?.name === 'AbortError') return
          const message = error instanceof Error && error.message !== ''
            ? error.message
            : '无法连接本地检索服务'
          updatePanel(requestId, (current) => ({
            ...current,
            globalError: message,
            sources: current.sources.map((source) => (
              source.status === 'loading'
                ? {
                    ...source,
                    status: 'error',
                    error: { code: 'client', message: '该库查询失败', detail: message },
                  }
                : source
            )),
          }))
        }
      }, [consumeNdjson, updatePanel])

      const startSearch = React.useCallback((text, truncated, options = {}) => {
        const sourceId = typeof options.sourceId === 'string' ? options.sourceId : null
        const sourceIds = sourceId !== null
          ? [sourceId]
          : (Array.isArray(options.sourceIds)
              ? options.sourceIds.filter((id) => DEFAULT_SOURCE_IDS.includes(id))
              : [...DEFAULT_SOURCE_IDS])
        const adaptive = options.adaptive === undefined ? prefs.smart : options.adaptive === true
        const catalog = initialSources()
        const requested = sourceId === null
          ? sourceIds
              .map((id) => catalog.find((source) => source.id === id))
              .filter((source) => source !== undefined)
          : catalog.filter((source) => source.id === sourceId)
        if (requested.length === 0) {
          showToast('没有可检索的数据库')
          return
        }

        const requestId = requestSeqRef.current + 1
        requestSeqRef.current = requestId
        abortRef.current?.abort()
        const controller = new AbortController()
        abortRef.current = controller
        setMenu(null)
        setSubmenuOpen(false)
        setBlastOpen(false)
        setPanel({
          requestId,
          mode: sourceId === null ? 'all' : 'single',
          sourceId,
          sourceIds,
          adaptive,
          queryKind: '',
          queryLabel: '',
          detectedValue: '',
          sequenceType: null,
          minimized: false,
          query: text,
          truncated: truncated === true,
          queryLength: text.length,
          globalError: '',
          sources: requested,
        })
        const requestBody = { query: text, adaptive }
        if (sourceId !== null) requestBody.source = sourceId
        else requestBody.sources = sourceIds
        void runSearch(requestId, requestBody, controller.signal)
      }, [prefs.smart, runSearch, showToast])

      const copyText = React.useCallback((text) => {
        const value = String(text)
        if (navigator.clipboard !== undefined && typeof navigator.clipboard.writeText === 'function') {
          navigator.clipboard.writeText(value).catch(() => fallbackCopy(value))
        } else {
          fallbackCopy(value)
        }
      }, [])

      const insertIntoComposer = React.useCallback((text) => {
        const candidates = Array.from(document.querySelectorAll(INPUT_SELECTOR))
          .filter((element) => !(element instanceof Element) || element.closest('[data-multidb-ui]') === null)
          .filter((element) => element instanceof HTMLTextAreaElement
            || element instanceof HTMLInputElement
            || element.isContentEditable)
          .filter((element) => element.offsetParent !== null)
        const target = candidates.find((element) => element.isContentEditable)
          ?? candidates.find((element) => element instanceof HTMLTextAreaElement)
          ?? candidates[0]
        if (target === undefined) return false
        try {
          target.focus()
          if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
            const start = typeof target.selectionStart === 'number' ? target.selectionStart : target.value.length
            const end = typeof target.selectionEnd === 'number' ? target.selectionEnd : start
            target.setRangeText(text, start, end, 'end')
            target.dispatchEvent(new Event('input', { bubbles: true }))
          } else {
            const selection = window.getSelection()
            if (selection !== null) {
              const range = document.createRange()
              range.selectNodeContents(target)
              range.collapse(false)
              selection.removeAllRanges()
              selection.addRange(range)
            }
            document.execCommand('insertText', false, text)
          }
          return true
        } catch {
          return false
        }
      }, [])

      const copySelection = React.useCallback(() => {
        if (menu === null) return
        const raw = menu.raw
        setMenu(null)
        setSubmenuOpen(false)
        setBlastOpen(false)
        if (navigator.clipboard !== undefined && typeof navigator.clipboard.writeText === 'function') {
          navigator.clipboard.writeText(raw).catch(() => fallbackCopy(raw))
        } else {
          fallbackCopy(raw)
        }
      }, [menu])

      // Selection-only context menu. No selection, no preventDefault: the
      // system menu is untouched outside conversation text.
      React.useEffect(() => {
        const onContext = (event) => {
          const target = elementOf(event.target)
          if (target === null) return
          if (target.closest('[data-multidb-ui]') !== null) return
          if (target.closest(INPUT_SELECTOR) !== null) return
          if (target.closest(CONVERSATION_SELECTOR) === null) return
          const selection = window.getSelection()
          if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return
          const anchor = elementOf(selection.anchorNode)
          const focus = elementOf(selection.focusNode)
          if (anchor === null || focus === null) return
          if (anchor.closest(CONVERSATION_SELECTOR) === null || focus.closest(CONVERSATION_SELECTOR) === null) return
          const raw = selection.toString()
          const normalized = normalizeSelectionText(raw)
          if (normalized.text === '') return
          event.preventDefault()
          event.stopPropagation()
          setSubmenuOpen(false)
          setBlastOpen(false)
          setMenu({
            x: event.clientX,
            y: event.clientY,
            raw,
            text: normalized.text,
            truncated: normalized.truncated,
            length: normalized.length,
          })
        }
        document.addEventListener('contextmenu', onContext, true)
        return () => document.removeEventListener('contextmenu', onContext, true)
      }, [])

      // Dismiss the menu on outside press, Escape, scroll or resize.
      React.useEffect(() => {
        if (menu === null) return undefined
        const close = () => {
          setSubmenuOpen(false)
          setBlastOpen(false)
          setMenu(null)
        }
        const onDown = (event) => {
          const target = event.target
          if (target instanceof Element && target.closest('[data-multidb-ui]') !== null) return
          close()
        }
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          event.stopPropagation()
          if (submenuOpen || blastOpen) {
            event.preventDefault()
            setSubmenuOpen(false)
            setBlastOpen(false)
            return
          }
          close()
        }
        document.addEventListener('mousedown', onDown, true)
        document.addEventListener('keydown', onKey, true)
        window.addEventListener('scroll', close, true)
        window.addEventListener('resize', close)
        return () => {
          document.removeEventListener('mousedown', onDown, true)
          document.removeEventListener('keydown', onKey, true)
          window.removeEventListener('scroll', close, true)
          window.removeEventListener('resize', close)
        }
      }, [menu, submenuOpen, blastOpen])

      React.useEffect(() => {
        if (menu !== null && firstMenuItemRef.current !== null) firstMenuItemRef.current.focus()
      }, [menu])

      React.useEffect(() => {
        if (!submenuOpen || !focusSubmenuRef.current) return
        focusSubmenuRef.current = false
        firstSubItemRef.current?.focus()
      }, [submenuOpen])

      React.useEffect(() => {
        if (!blastOpen || !focusBlastRef.current) return
        focusBlastRef.current = false
        firstBlastItemRef.current?.focus()
      }, [blastOpen])

      // Messages from the sandboxed iframe. event.origin is "null" by design
      // (opaque sandbox origin), so the window identity is the authority here.
      React.useEffect(() => {
        const onMessage = (event) => {
          const frameWindow = iframeRef.current?.contentWindow
          if (frameWindow === null || frameWindow === undefined || event.source !== frameWindow) return
          const data = event.data
          if (data === null || typeof data !== 'object' || data.ns !== NS) return
          switch (data.type) {
            case 'ready':
              setFrameReady(true)
              break
            case 'close':
              closePanel()
              break
            case 'minimize':
              setPanel((current) => (current === null ? current : { ...current, minimized: true }))
              break
            case 'restore':
              setPanel((current) => (current === null ? current : { ...current, minimized: false }))
              break
            case 'open-link': {
              const url = safeExternalUrl(data.url)
              if (url !== null) window.open(url, '_blank', 'noopener,noreferrer')
              break
            }
            case 'copy-text': {
              const text = sanitizeIncomingText(data.text)
              if (text !== '') {
                copyText(text)
                showToast('已复制')
              }
              break
            }
            case 'insert-text': {
              const text = sanitizeIncomingText(data.text)
              if (text === '') break
              if (insertIntoComposer(text)) showToast('已插入输入框')
              else {
                copyText(text)
                showToast('未找到输入框，已复制')
              }
              break
            }
            case 'retry-query': {
              const current = panelRef.current
              if (current === null) break
              startSearch(current.query, current.truncated, {
                sourceId: current.sourceId,
                sourceIds: current.sourceId === null ? current.sourceIds : undefined,
                adaptive: data.adaptive === true,
              })
              break
            }
            default:
              break
          }
        }
        window.addEventListener('message', onMessage)
        return () => window.removeEventListener('message', onMessage)
      }, [closePanel, copyText, insertIntoComposer, showToast, startSearch])

      // Push the full panel state into the iframe. The first message after a
      // frame becomes ready is `init`; later changes are `state` updates.
      React.useEffect(() => {
        if (!frameReady || panel === null) return
        if (!initializedRef.current) {
          initializedRef.current = true
          postToFrame({ type: 'init', state: panel, theme: readTheme(windowRef.current) })
        } else {
          postToFrame({ type: 'state', state: panel })
        }
      }, [frameReady, panel, postToFrame])

      React.useEffect(() => () => {
        abortRef.current?.abort()
        if (toastTimerRef.current !== null) clearTimeout(toastTimerRef.current)
      }, [])

      const blastTarget = menu === null ? null : detectBlastTarget(menu.text)
      const blastAccession = menu === null ? '' : detectBlastAccession(menu.text)
      const showBlast = menu !== null && (blastTarget !== null || blastAccession !== '')
      const menuItemCount = 4 + (showBlast ? 1 : 0)
      const submenuSide = menu === null || menu.x + 196 + 292 <= window.innerWidth - 8 ? 'right' : 'left'
      const submenuAlign = menu === null
        || menu.y + ordered.length * 34 + 40 + 8 <= window.innerHeight
        ? 'top'
        : 'bottom'

      const openBlast = (kind) => {
        const url = kind === 'uniprot'
          ? (blastAccession === '' ? '' : uniprotBlastUrl(blastAccession))
          : ncbiBlastUrl(blastTarget, blastAccession)
        if (url === '') return
        window.open(url, '_blank', 'noopener,noreferrer')
        setMenu(null)
        setSubmenuOpen(false)
        setBlastOpen(false)
      }

      const renderSourceRow = (source, index) => {
        const enabled = enabledSet.has(source.id)
        return h('div', {
          key: source.id,
          className: 'dsh-multidb-lens-source-row',
        },
        h('span', {
          className: 'dsh-multidb-lens-source-move',
        },
        h('button', {
          type: 'button',
          className: 'dsh-multidb-lens-source-move-btn',
          title: '上移一位',
          'aria-label': `上移 ${source.name}`,
          disabled: index === 0,
          onClick: () => moveSourceBy(source.id, -1),
        }, '▲'),
        h('button', {
          type: 'button',
          className: 'dsh-multidb-lens-source-move-btn',
          title: '下移一位',
          'aria-label': `下移 ${source.name}`,
          disabled: index === ordered.length - 1,
          onClick: () => moveSourceBy(source.id, 1),
        }, '▼')),
        h('button', {
          type: 'button',
          role: 'menuitem',
          ref: index === 0 ? firstSubItemRef : null,
          className: 'dsh-multidb-lens-menu-item dsh-multidb-lens-source-pick',
          title: `${source.name} · ${source.subtitle}`,
          onClick: () => startSearch(menu.text, menu.truncated, { sourceId: source.id }),
        }, sourceDot(source.color), h('span', null, source.name), h('small', {
          className: 'dsh-multidb-lens-menu-hint',
        }, source.subtitle)),
        h('button', {
          type: 'button',
          role: 'menuitemcheckbox',
          'aria-checked': enabled ? 'true' : 'false',
          'aria-label': `${enabled ? '从全库搜索中排除' : '加入全库搜索'} ${source.name}`,
          title: enabled ? '从全库搜索中排除' : '加入全库搜索',
          className: 'dsh-multidb-lens-source-toggle',
          onClick: () => toggleSource(source.id),
        }, enabled ? '✓' : ''))
      }

      const menuNode = menu === null ? null : h('div', {
        ref: menuRef,
        'data-multidb-ui': '',
        className: 'dsh-multidb-lens-menu',
        role: 'menu',
        'aria-label': '划词多库透镜右键菜单',
        style: placeMenu(menu.x, menu.y, menuItemCount),
        onContextMenu: (event) => event.preventDefault(),
      },
      h('button', {
        type: 'button',
        role: 'menuitem',
        ref: firstMenuItemRef,
        className: 'dsh-multidb-lens-menu-item',
        onClick: copySelection,
      }, copyIcon(), h('span', null, '复制')),
      h('button', {
        type: 'button',
        role: 'menuitem',
        'aria-disabled': enabledIds.length === 0 ? 'true' : 'false',
        className: 'dsh-multidb-lens-menu-item',
        title: menu.truncated ? '检索词将截断为前 200 个字符' : menu.text,
        onClick: () => {
          if (enabledIds.length === 0) {
            showToast('请先启用至少一个数据库')
            return
          }
          startSearch(menu.text, menu.truncated, { sourceIds: enabledIds })
        },
      }, lensIcon(), h('span', null, '全库搜索'), h('small', {
        className: 'dsh-multidb-lens-menu-hint',
      }, `${enabledIds.length} 个库`)),
      h('div', {
        className: 'dsh-multidb-lens-submenu-wrap',
        onMouseEnter: () => setSubmenuOpen(true),
        onMouseLeave: () => setSubmenuOpen(false),
      },
      h('button', {
        type: 'button',
        role: 'menuitem',
        ref: singleItemRef,
        className: 'dsh-multidb-lens-menu-item',
        'aria-haspopup': 'menu',
        'aria-expanded': submenuOpen ? 'true' : 'false',
        title: '选择一个数据库单独检索；勾选控制全库搜索范围，拖动排序',
        onClick: () => {
          focusSubmenuRef.current = false
          setSubmenuOpen(true)
        },
        onKeyDown: (event) => {
          if (event.key !== 'ArrowRight' && event.key !== 'ArrowDown') return
          event.preventDefault()
          focusSubmenuRef.current = true
          setSubmenuOpen(true)
        },
      }, lensIcon(), h('span', null, '单库搜索'), h('span', {
        className: 'dsh-multidb-lens-chevron',
        'aria-hidden': true,
      }, '›')),
      submenuOpen ? h('div', {
        className: 'dsh-multidb-lens-submenu',
        role: 'menu',
        'aria-label': '选择单个数据库',
        'data-side': submenuSide,
        'data-align': submenuAlign,
        onKeyDown: (event) => {
          if (event.key !== 'ArrowLeft') return
          event.preventDefault()
          setSubmenuOpen(false)
          singleItemRef.current?.focus()
        },
      }, h('div', {
        className: 'dsh-multidb-lens-submenu-note',
      }, '勾选决定全库范围 · 点击名称单独检索 · ▲▼ 排序'),
      ordered.map(renderSourceRow)) : null),
      h('button', {
        type: 'button',
        role: 'menuitemcheckbox',
        'aria-checked': prefs.smart ? 'true' : 'false',
        className: 'dsh-multidb-lens-menu-item',
        title: prefs.smart ? '已识别 DOI/PMID/登录号/物种名并适配各库语法' : '按选区原文发送给各库',
        onClick: () => setPrefs((current) => ({ ...current, smart: !current.smart })),
      }, smartIcon(), h('span', null, '智能检索词'), h('small', {
        className: 'dsh-multidb-lens-menu-hint',
      }, prefs.smart ? '已开启' : '已关闭')),
      showBlast ? h('div', {
        className: 'dsh-multidb-lens-submenu-wrap',
        onMouseEnter: () => setBlastOpen(true),
        onMouseLeave: () => setBlastOpen(false),
      },
      h('button', {
        type: 'button',
        role: 'menuitem',
        ref: blastItemRef,
        className: 'dsh-multidb-lens-menu-item',
        'aria-haspopup': 'menu',
        'aria-expanded': blastOpen ? 'true' : 'false',
        title: blastTarget === null ? '在比对工具中打开该登录号' : '在比对工具中打开这段序列',
        onClick: () => {
          focusBlastRef.current = false
          setBlastOpen(true)
        },
        onKeyDown: (event) => {
          if (event.key !== 'ArrowRight' && event.key !== 'ArrowDown') return
          event.preventDefault()
          focusBlastRef.current = true
          setBlastOpen(true)
        },
      }, blastIcon(), h('span', null, 'BLAST 比对'), h('span', {
        className: 'dsh-multidb-lens-chevron',
        'aria-hidden': true,
      }, '›')),
      blastOpen ? h('div', {
        className: 'dsh-multidb-lens-submenu',
        role: 'menu',
        'aria-label': '选择比对工具',
        'data-side': submenuSide,
        'data-align': submenuAlign,
        onKeyDown: (event) => {
          if (event.key !== 'ArrowLeft') return
          event.preventDefault()
          setBlastOpen(false)
          blastItemRef.current?.focus()
        },
      },
      h('button', {
        type: 'button',
        role: 'menuitem',
        ref: firstBlastItemRef,
        className: 'dsh-multidb-lens-menu-item',
        title: '在 NCBI BLAST 中比对序列或登录号',
        onClick: () => openBlast('ncbi'),
      }, sourceDot('#2f6fdb'), h('span', null, 'NCBI BLAST'), h('small', {
        className: 'dsh-multidb-lens-menu-hint',
      }, blastTarget === null ? '登录号' : blastTarget.type === 'dna' ? 'blastn' : 'blastp')),
      blastAccession === '' ? null : h('button', {
        type: 'button',
        role: 'menuitem',
        className: 'dsh-multidb-lens-menu-item',
        title: '在 UniProt BLAST 中打开该登录号',
        onClick: () => openBlast('uniprot'),
      }, sourceDot('#0b7a75'), h('span', null, 'UniProt BLAST'), h('small', {
        className: 'dsh-multidb-lens-menu-hint',
      }, blastAccession))) : null) : null)

      const panelLabel = panel !== null && panel.mode === 'single' ? '单库检索结果' : '全库检索结果'
      const panelNode = panel === null ? null : h('div', {
        ref: windowRef,
        'data-multidb-ui': '',
        'data-minimized': panel.minimized ? 'true' : 'false',
        'data-mode': panel.mode === 'single' ? 'single' : 'all',
        className: 'dsh-multidb-lens-window',
        role: 'dialog',
        'aria-label': panelLabel,
      },
      h('iframe', {
        ref: iframeRef,
        className: 'dsh-multidb-lens-frame',
        title: '检索结果',
        sandbox: 'allow-scripts',
        referrerPolicy: 'no-referrer',
        srcDoc: PANEL_HTML,
        onLoad: () => setFrameReady(true),
      }))

      const toastNode = toast === null ? null : h('div', {
        'data-multidb-ui': '',
        className: 'dsh-multidb-lens-toast',
        role: 'status',
        'aria-live': 'polite',
      }, toast)

      return h(React.Fragment, null, menuNode, panelNode, toastNode)
    }

    function apply(ctx) {
      const style = document.createElement('style')
      style.setAttribute('data-dsh-multidb-lens', '')
      style.textContent = CSS
      document.head.appendChild(style)
      if (typeof ctx.effect === 'function') {
        ctx.effect(() => () => {
          if (style.parentNode !== null) style.parentNode.removeChild(style)
        })
      }

      const slots = ctx.get?.('slots') ?? ctx.slots
      if (slots === undefined || slots === null) return
      slots.inject('shell.overlay', () => slots.register({
        name: 'shell.overlay',
        id: 'dsh-multidb-lens',
        order: 240,
      }, LensOverlay))
    }

    return {
      name: 'dsh-multidb-lens-client',
      inject: ['slots'],
      apply,
    }
  },
})
