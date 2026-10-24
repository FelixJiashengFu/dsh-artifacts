/**
 * Turn one artifact snapshot into a complete, self-contained HTML document.
 *
 * The same builder serves the sidebar preview (as an iframe `srcdoc` in an
 * opaque-origin sandbox), the standalone "open in new tab" page (served with a
 * CSP `sandbox` header), and the "download as HTML" export. Every document
 * starts with the bridge script, which provides the Claude-compatible
 * `window.storage` and `window.claude.complete` APIs and reports errors to the
 * host page through `postMessage`.
 */
import type { ArtifactRecord, CdnConfig } from './types.ts'
import { SHADCN_SHIM } from './shadcn-shim.ts'

export interface DocumentOptions {
  readonly cdn: CdnConfig
  /** Colour scheme for documents this plugin styles (markdown, code, mermaid). */
  readonly theme: 'light' | 'dark'
}

/** Pinned library versions loaded inside the iframe. */
export const LIBS = {
  react: '18.3.1',
  babel: '7.26.10',
  mermaid: '11.4.1',
  marked: '15.0.7',
  katex: '0.16.21',
  highlight: '11.11.1',
} as const

/** Encode a string as a JS string literal that is safe inside `<script>`. */
export function scriptString(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/** Escape text for an HTML text/attribute context. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c]!)
}

/**
 * The bridge: runs first in every artifact document. Inside the sidebar it
 * forwards storage/AI calls to the host page; standalone it degrades to an
 * in-memory store so pages still work offline from a downloaded file.
 */
export const BRIDGE_SCRIPT = String.raw`(function(){
"use strict";
var embedded = false;
try { embedded = window.parent !== window; } catch (e) { embedded = true; }
var seq = 0, pending = {};
function post(msg){ msg.__dshArtifact = 1; try { window.parent.postMessage(msg, '*'); } catch (e) {} }
function call(op, payload, timeoutMs){
  return new Promise(function(resolve, reject){
    var id = ++seq;
    var timer = setTimeout(function(){ delete pending[id]; reject(new Error(op + ' timed out')); }, timeoutMs);
    pending[id] = {
      resolve: function(v){ clearTimeout(timer); resolve(v); },
      reject: function(e){ clearTimeout(timer); reject(e); }
    };
    post({ kind: 'call', id: id, op: op, payload: payload });
  });
}
window.addEventListener('message', function(event){
  if (event.source !== window.parent) return;
  var d = event.data;
  if (!d || d.__dshArtifact !== 1 || d.kind !== 'reply') return;
  var p = pending[d.id]; if (!p) return; delete pending[d.id];
  if (d.ok) p.resolve(d.value); else p.reject(new Error(d.error || 'Request failed'));
});
var memory = { personal: {}, shared: {} };
function bucket(shared){ return shared ? memory.shared : memory.personal; }
function localOp(op, a){
  var b = bucket(a.shared);
  if (op === 'get') return Promise.resolve(Object.prototype.hasOwnProperty.call(b, a.key) ? { key: a.key, value: b[a.key], shared: !!a.shared } : null);
  if (op === 'set') { b[a.key] = a.value; return Promise.resolve({ key: a.key, value: a.value, shared: !!a.shared }); }
  if (op === 'delete') { var had = Object.prototype.hasOwnProperty.call(b, a.key); delete b[a.key]; return Promise.resolve({ key: a.key, deleted: had, shared: !!a.shared }); }
  var keys = Object.keys(b).filter(function(k){ return !a.prefix || k.indexOf(a.prefix) === 0; });
  return Promise.resolve({ keys: keys, prefix: a.prefix, shared: !!a.shared });
}
function op(name, args){ return embedded ? call('storage.' + name, args, 15000) : localOp(name, args); }
function str(v){ return typeof v === 'string' ? v : JSON.stringify(v); }
var storage = {
  get: function(key, shared){ return op('get', { key: String(key), shared: !!shared }); },
  set: function(key, value, shared){ return op('set', { key: String(key), value: str(value), shared: !!shared }); },
  delete: function(key, shared){ return op('delete', { key: String(key), shared: !!shared }); },
  list: function(prefix, shared){ return op('list', { prefix: prefix == null ? undefined : String(prefix), shared: !!shared }); }
};
try { Object.defineProperty(window, 'storage', { value: storage, configurable: true, writable: true }); } catch (e) { window.storage = storage; }
function complete(input, options){
  if (!embedded) return Promise.reject(new Error('AI completion is only available inside DeepSeek Harness.'));
  return call('complete', { prompt: input, options: options || {} }, 180000).then(function(r){ return r && typeof r.text === 'string' ? r.text : ''; });
}
window.dsh = Object.assign(window.dsh || {}, { storage: storage, complete: complete, embedded: embedded });
window.claude = window.claude || {};
if (typeof window.claude.complete !== 'function') window.claude.complete = complete;
function report(kind, message, stack){
  post({ kind: 'error', error: { kind: kind, message: String(message || 'Unknown error').slice(0, 4000), stack: stack ? String(stack).slice(0, 8000) : undefined } });
}
window.__dshReport = report;
window.addEventListener('error', function(e){
  var t = e && e.target;
  if (t && t !== window && t.tagName) {
    if (t.tagName === 'SCRIPT' || (t.tagName === 'LINK' && /stylesheet/i.test(t.rel || ''))) report('resource', 'Failed to load ' + (t.src || t.href));
    return;
  }
  report('runtime', (e && e.message) || (e && e.error && e.error.message), e && e.error && e.error.stack);
}, true);
window.addEventListener('unhandledrejection', function(e){
  var r = e && e.reason;
  report('promise', r && r.message ? r.message : String(r), r && r.stack);
});
document.addEventListener('click', function(e){
  if (e.defaultPrevented || e.button !== 0) return;
  var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
  if (!a) return;
  var href = a.getAttribute('href') || '';
  if (href.charAt(0) === '#' || /^javascript:/i.test(href) || a.hasAttribute('download')) return;
  if (a.target && a.target !== '_self') return;
  e.preventDefault();
  try { window.open(a.href, '_blank', 'noopener'); } catch (err) {}
});
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function(){ post({ kind: 'ready' }); });
else post({ kind: 'ready' });
})();`

const BASE_HEAD = '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'

function bridgeTag(): string {
  return `<script>${BRIDGE_SCRIPT}</script>`
}

function themeColors(theme: 'light' | 'dark'): { bg: string; fg: string; muted: string; border: string; code: string; link: string } {
  return theme === 'dark'
    ? { bg: '#16181d', fg: '#e6e8ec', muted: '#9aa1ad', border: '#2c313a', code: '#1f232a', link: '#7aa7ff' }
    : { bg: '#ffffff', fg: '#1d2129', muted: '#5c6370', border: '#e3e6eb', code: '#f5f6f8', link: '#2257d6' }
}

/**
 * Build the complete document for one artifact.
 * @param record - the snapshot to render.
 * @param options - CDN bases and colour scheme.
 * @returns a full HTML document string.
 */
export function buildDocument(record: ArtifactRecord, options: DocumentOptions): string {
  switch (record.type) {
    case 'html': return htmlDocument(record, options)
    case 'svg': return svgDocument(record, options)
    case 'mermaid': return mermaidDocument(record, options)
    case 'markdown': return markdownDocument(record, options)
    case 'code': return codeDocument(record, options)
    case 'react': return reactDocument(record, options)
  }
}

function htmlDocument(record: ArtifactRecord, _options: DocumentOptions): string {
  const content = record.content
  const head = bridgeTag()
  const headOpen = /<head(\s[^>]*)?>/i.exec(content)
  if (headOpen) {
    const at = headOpen.index + headOpen[0].length
    return content.slice(0, at) + head + content.slice(at)
  }
  const htmlOpen = /<html(\s[^>]*)?>/i.exec(content)
  if (htmlOpen) {
    const at = htmlOpen.index + htmlOpen[0].length
    return `${content.slice(0, at)}<head>${BASE_HEAD}${head}</head>${content.slice(at)}`
  }
  const doctype = /^\s*<!doctype[^>]*>/i.exec(content)
  if (doctype) {
    const at = doctype.index + doctype[0].length
    return `${content.slice(0, at)}<head>${BASE_HEAD}${head}</head>${content.slice(at)}`
  }
  return `<!doctype html><html><head>${BASE_HEAD}<title>${escapeHtml(record.title)}</title>${head}</head><body>${content}</body></html>`
}

function svgDocument(record: ArtifactRecord, _options: DocumentOptions): string {
  return `<!doctype html><html><head>${BASE_HEAD}<title>${escapeHtml(record.title)}</title>${bridgeTag()}
<style>html,body{margin:0;height:100%;background:#fff}body{display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}body>svg{max-width:100%;max-height:calc(100vh - 32px);height:auto}</style>
</head><body>${record.content}</body></html>`
}

function mermaidDocument(record: ArtifactRecord, options: DocumentOptions): string {
  const c = themeColors(options.theme)
  const { npm } = options.cdn
  return String.raw`<!doctype html><html><head>${BASE_HEAD}<title>${escapeHtml(record.title)}</title>${bridgeTag()}
<style>html,body{margin:0;min-height:100%;background:${c.bg};color:${c.fg};font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
#diagram{display:flex;justify-content:center;padding:24px;box-sizing:border-box}#diagram svg{max-width:100%;height:auto}
.err{white-space:pre-wrap;color:#d9363e;padding:16px;font-family:ui-monospace,monospace}</style>
</head><body><div id="diagram">Rendering…</div>
<script type="module">
const code = ${scriptString(record.content)};
const target = document.getElementById('diagram');
try {
  const { default: mermaid } = await import('${npm}/mermaid@${LIBS.mermaid}/dist/mermaid.esm.min.mjs');
  mermaid.initialize({ startOnLoad: false, theme: '${options.theme === 'dark' ? 'dark' : 'default'}', securityLevel: 'strict' });
  const { svg } = await mermaid.render('dsh-mermaid-' + Date.now(), code);
  target.innerHTML = svg;
} catch (e) {
  target.innerHTML = '';
  const pre = document.createElement('pre'); pre.className = 'err'; pre.textContent = 'Mermaid error: ' + (e && e.message ? e.message : e);
  target.appendChild(pre);
  window.__dshReport('render', e && e.message ? e.message : String(e), e && e.stack);
}
</script></body></html>`
}

/** Shared typography for markdown and code documents. */
function proseStyle(theme: 'light' | 'dark'): string {
  const c = themeColors(theme)
  return `html,body{margin:0;background:${c.bg};color:${c.fg}}
body{font:15px/1.7 system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased}
.doc{max-width:760px;margin:0 auto;padding:32px 28px 64px;box-sizing:border-box;overflow-wrap:break-word}
.doc h1,.doc h2,.doc h3,.doc h4{line-height:1.3;margin:1.6em 0 .6em;font-weight:650}
.doc h1{font-size:1.9em;margin-top:.2em}.doc h2{font-size:1.45em;padding-bottom:.25em;border-bottom:1px solid ${c.border}}.doc h3{font-size:1.2em}
.doc p,.doc ul,.doc ol,.doc blockquote,.doc table,.doc pre{margin:0 0 1em}
.doc a{color:${c.link};text-decoration:none}.doc a:hover{text-decoration:underline}
.doc blockquote{border-left:3px solid ${c.border};padding:.1em 1em;color:${c.muted}}
.doc code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.88em;background:${c.code};padding:.15em .35em;border-radius:4px}
.doc pre{background:${c.code};padding:14px 16px;border-radius:8px;overflow:auto;line-height:1.55}
.doc pre code{background:none;padding:0;font-size:.86em}
.doc table{border-collapse:collapse;display:block;overflow:auto}
.doc th,.doc td{border:1px solid ${c.border};padding:6px 12px}.doc th{background:${c.code}}
.doc img{max-width:100%}.doc hr{border:0;border-top:1px solid ${c.border};margin:2em 0}
.doc .katex-display{overflow-x:auto;overflow-y:hidden;padding:.2em 0}
.doc .mermaid-block{display:flex;justify-content:center;margin:0 0 1em}.doc .mermaid-block svg{max-width:100%;height:auto}
.hljs{background:transparent!important}`
}

function markdownDocument(record: ArtifactRecord, options: DocumentOptions): string {
  const { npm } = options.cdn
  const hlTheme = options.theme === 'dark' ? 'github-dark' : 'github'
  return String.raw`<!doctype html><html><head>${BASE_HEAD}<title>${escapeHtml(record.title)}</title>${bridgeTag()}
<link rel="stylesheet" href="${npm}/katex@${LIBS.katex}/dist/katex.min.css">
<link rel="stylesheet" href="${npm}/@highlightjs/cdn-assets@${LIBS.highlight}/styles/${hlTheme}.min.css">
<style>${proseStyle(options.theme)}</style>
</head><body><article id="doc" class="doc"></article>
<script type="module">
const source = ${scriptString(record.content)};
const doc = document.getElementById('doc');
function protectMath(src) {
  const store = [];
  const token = (tex, display) => { store.push({ tex, display }); return (display ? '\n\n' : '') + '@@DSHMATH' + (store.length - 1) + '@@' + (display ? '\n\n' : ''); };
  const parts = src.split(/(\x60\x60\x60[\s\S]*?\x60\x60\x60|~~~[\s\S]*?~~~|\x60[^\x60\n]*\x60)/g);
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = parts[i]
      .replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => token(tex, true))
      .replace(/\\\[([\s\S]+?)\\\]/g, (_, tex) => token(tex, true))
      .replace(/\\\(([\s\S]+?)\\\)/g, (_, tex) => token(tex, false))
      .replace(/(^|[^\\$])\$(?![\s$])([^$\n]+?)(?<!\s)\$(?!\d)/g, (_, pre, tex) => pre + token(tex, false));
  }
  return { text: parts.join(''), store };
}
try {
  const { marked } = await import('${npm}/marked@${LIBS.marked}/lib/marked.esm.js');
  const { text, store } = protectMath(source);
  let html = marked.parse(text, { gfm: true, breaks: false });
  if (store.length) {
    let katex;
    try { katex = (await import('${npm}/katex@${LIBS.katex}/dist/katex.mjs')).default; } catch (e) {}
    html = html.replace(/@@DSHMATH(\d+)@@/g, (_, i) => {
      const m = store[Number(i)];
      if (!katex) return m.display ? '<pre>' + m.tex.replace(/</g, '&lt;') + '</pre>' : '<code>' + m.tex.replace(/</g, '&lt;') + '</code>';
      return katex.renderToString(m.tex, { displayMode: m.display, throwOnError: false });
    });
  }
  doc.innerHTML = html;
  const mermaidBlocks = doc.querySelectorAll('pre > code.language-mermaid');
  if (mermaidBlocks.length) {
    try {
      const { default: mermaid } = await import('${npm}/mermaid@${LIBS.mermaid}/dist/mermaid.esm.min.mjs');
      mermaid.initialize({ startOnLoad: false, theme: '${options.theme === 'dark' ? 'dark' : 'default'}', securityLevel: 'strict' });
      let n = 0;
      for (const code of mermaidBlocks) {
        const pre = code.parentElement;
        try {
          const { svg } = await mermaid.render('dsh-md-mermaid-' + (n++), code.textContent);
          const div = document.createElement('div'); div.className = 'mermaid-block'; div.innerHTML = svg; pre.replaceWith(div);
        } catch (e) { window.__dshReport('render', 'Mermaid: ' + (e && e.message ? e.message : e)); }
      }
    } catch (e) {}
  }
  const codeBlocks = doc.querySelectorAll('pre > code');
  if (codeBlocks.length) {
    try {
      const { default: hljs } = await import('${npm}/@highlightjs/cdn-assets@${LIBS.highlight}/es/highlight.min.js');
      for (const block of codeBlocks) hljs.highlightElement(block);
    } catch (e) {}
  }
} catch (e) {
  doc.textContent = source;
  doc.style.whiteSpace = 'pre-wrap';
  window.__dshReport('render', e && e.message ? e.message : String(e), e && e.stack);
}
</script></body></html>`
}

function codeDocument(record: ArtifactRecord, options: DocumentOptions): string {
  const { npm } = options.cdn
  const c = themeColors(options.theme)
  const hlTheme = options.theme === 'dark' ? 'github-dark' : 'github'
  const language = (record.language ?? '').toLowerCase().replace(/[^a-z0-9+#-]/g, '')
  return String.raw`<!doctype html><html><head>${BASE_HEAD}<title>${escapeHtml(record.title)}</title>${bridgeTag()}
<link rel="stylesheet" href="${npm}/@highlightjs/cdn-assets@${LIBS.highlight}/styles/${hlTheme}.min.css">
<style>html,body{margin:0;background:${c.bg};color:${c.fg}}
.wrap{display:flex;font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;padding:16px 0;min-width:max-content}
.gutter{margin:0;padding:0 12px 0 16px;text-align:right;color:${c.muted};user-select:none;border-right:1px solid ${c.border}}
.src{margin:0;padding:0 16px}.src code{font:inherit;padding:0!important}.hljs{background:transparent!important}</style>
</head><body><div class="wrap"><pre class="gutter" id="gutter"></pre><pre class="src"><code id="code"${language ? ` class="language-${language}"` : ''}></code></pre></div>
<script type="module">
const source = ${scriptString(record.content)};
const el = document.getElementById('code');
el.textContent = source;
const lines = source.split('\n').length;
document.getElementById('gutter').textContent = Array.from({ length: lines }, (_, i) => String(i + 1)).join('\n');
try {
  const { default: hljs } = await import('${npm}/@highlightjs/cdn-assets@${LIBS.highlight}/es/highlight.min.js');
  const lang = ${scriptString(language)};
  if (lang && hljs.getLanguage(lang)) el.innerHTML = hljs.highlight(source, { language: lang }).value;
  else el.innerHTML = hljs.highlightAuto(source).value;
} catch (e) {}
</script></body></html>`
}

/** Well-known Claude-artifact import names mapped to their npm packages. */
const REACT_IMPORT_ALIASES: Readonly<Record<string, string>> = {
  'plotly': 'plotly.js-dist-min',
}

function reactDocument(record: ArtifactRecord, options: DocumentOptions): string {
  const { npm, esm, tailwind } = options.cdn
  const reactUrl = `${esm}/react@${LIBS.react}`
  const reactDomUrl = `${esm}/react-dom@${LIBS.react}`
  const importMap = {
    imports: {
      'react': reactUrl,
      'react/': `${reactUrl}/`,
      'react-dom': reactDomUrl,
      'react-dom/': `${reactDomUrl}/`,
    },
  }
  return String.raw`<!doctype html><html><head>${BASE_HEAD}<title>${escapeHtml(record.title)}</title>${bridgeTag()}
<script type="importmap">${JSON.stringify(importMap)}</script>
<script src="${tailwind}"></script>
<script src="${npm}/@babel/standalone@${LIBS.babel}/babel.min.js"></script>
<style>html,body{margin:0;min-height:100%;background:#fff}#root{min-height:100vh}
.dsh-error{font:13px/1.5 ui-monospace,Menlo,Consolas,monospace;color:#b42318;background:#fef3f2;border:1px solid #fecdca;border-radius:8px;margin:16px;padding:12px 14px;white-space:pre-wrap}</style>
</head><body><div id="root"></div>
<script type="module">
const source = ${scriptString(record.content)};
const ESM = ${scriptString(esm)};
const ALIASES = ${JSON.stringify(REACT_IMPORT_ALIASES)};
const SHIM = ${scriptString(SHADCN_SHIM)};
const root = document.getElementById('root');
function fail(kind, error) {
  const message = error && error.message ? error.message : String(error);
  root.innerHTML = '';
  const box = document.createElement('div'); box.className = 'dsh-error'; box.textContent = message; root.appendChild(box);
  window.__dshReport(kind, message, error && error.stack);
}
let shimUrl;
function resolveSpecifier(spec) {
  if (/^(https?:|blob:|data:)/.test(spec)) return spec;
  if (spec === 'react' || spec.startsWith('react/') || spec === 'react-dom' || spec.startsWith('react-dom/')) return spec;
  if (spec.startsWith('@/components/ui') || spec === '@/lib/utils' || spec.startsWith('@/components/')) {
    shimUrl = shimUrl || URL.createObjectURL(new Blob([SHIM], { type: 'text/javascript' }));
    return shimUrl;
  }
  const [head, ...rest] = spec.startsWith('@') ? [spec.split('/').slice(0, 2).join('/'), ...spec.split('/').slice(2)] : spec.split('/');
  const pkg = ALIASES[head] || head;
  const path = rest.length ? '/' + rest.join('/') : '';
  return ESM + '/' + pkg + path + '?external=react,react-dom';
}
function rewriteImports() {
  const fix = (node) => { if (node && node.source && typeof node.source.value === 'string') node.source.value = resolveSpecifier(node.source.value); };
  return { visitor: {
    ImportDeclaration(p) { fix(p.node); },
    ExportNamedDeclaration(p) { fix(p.node); },
    ExportAllDeclaration(p) { fix(p.node); },
    CallExpression(p) {
      const n = p.node;
      if (n.callee && n.callee.type === 'Import' && n.arguments[0] && n.arguments[0].type === 'StringLiteral') n.arguments[0].value = resolveSpecifier(n.arguments[0].value);
    },
  } };
}
let compiled;
try {
  compiled = Babel.transform(source, {
    filename: 'artifact.tsx',
    sourceType: 'module',
    presets: [['react', { runtime: 'automatic' }], ['typescript', { isTSX: true, allExtensions: true }]],
    plugins: [rewriteImports],
  }).code;
} catch (e) {
  fail('compile', e);
}
if (compiled !== undefined) {
  try {
    const React = await import('react');
    const { createRoot } = await import('react-dom/client');
    const url = URL.createObjectURL(new Blob([compiled], { type: 'text/javascript' }));
    const mod = await import(url);
    let App = mod.default;
    if (typeof App !== 'function' && !(App && typeof App === 'object' && App.$$typeof)) {
      App = Object.values(mod).find(v => typeof v === 'function');
    }
    if (!App) throw new Error('The artifact has no default-exported React component.');
    class Boundary extends React.Component {
      constructor(props) { super(props); this.state = { error: null }; }
      static getDerivedStateFromError(error) { return { error }; }
      componentDidCatch(error) { window.__dshReport('runtime', error && error.message ? error.message : String(error), error && error.stack); }
      render() {
        if (this.state.error) return React.createElement('div', { className: 'dsh-error' }, String(this.state.error && this.state.error.message || this.state.error));
        return this.props.children;
      }
    }
    createRoot(root).render(React.createElement(Boundary, null, React.createElement(App)));
  } catch (e) {
    fail('runtime', e);
  }
}
</script></body></html>`
}

/** Absolute CDN origins a document may load from; used for documentation. */
export function cdnOrigins(cdn: CdnConfig): string[] {
  const origins = new Set<string>()
  for (const url of [cdn.npm, cdn.esm, cdn.tailwind]) {
    try {
      origins.add(new URL(url).origin)
    } catch {
      // ignore malformed config here; the Host validates it
    }
  }
  return [...origins]
}
