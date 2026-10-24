# dsh-artifacts — Artifacts for DeepSeek Harness

English | [中文](README.zh.md)

[npm package](https://www.npmjs.com/package/dsh-artifacts-felix) · [Releases](https://github.com/FelixJiashengFu/dsh-artifacts/releases) · [Report an issue](https://github.com/FelixJiashengFu/dsh-artifacts/issues)

Published on npm as **`dsh-artifacts-felix`**. The internal plugin ID remains `dsh-artifacts`; the unscoped npm name `dsh-artifacts` belongs to a separate publisher.

Gives DeepSeek Harness (dsh) the same capability as Claude's Artifacts: the agent writes web pages, interactive React apps, SVG, Mermaid diagrams, Markdown documents and code into a **versioned, live-rendered side panel**. Users switch versions, view source, copy, download, and open artifacts in a new browser tab; artifact code can persist data and call the model.

It is a standard dsh plugin package (a Cordis bundle plus a browser client module) that attaches only to documented dsh extension points.

![Markdown artifact with math, a table, a Mermaid diagram and code in DeepSeek Harness](https://raw.githubusercontent.com/FelixJiashengFu/dsh-artifacts/main/docs/screenshot.png)

## Feature map

| Claude Artifacts | dsh-artifacts |
|---|---|
| `artifacts` tool: create / update / rewrite | `artifact` tool: `create`, `update` (unique `old_str` → `new_str`), `rewrite`; accepts Claude's MIME type names |
| HTML, React, SVG, Mermaid, Markdown, code | the same six types |
| React with Tailwind, lucide-react, recharts, shadcn/ui | in-browser Babel for JSX/TSX, Tailwind, **any npm package** by name (via esm.sh), built-in shadcn/ui-compatible components for `@/components/ui/*` |
| Markdown | GFM tables, KaTeX math (`$…$`, `$$…$$`), ```mermaid blocks, code highlighting |
| Live side panel | right-sidebar tab with an opaque-origin sandboxed iframe |
| Version history | every call is a version; ◀ ▶ navigation; the panel follows new versions |
| Preview/code, copy, download | preview/code toggle, copy source, download source or a standalone HTML page |
| Publish / open | open in a new browser tab (standalone page served with `Content-Security-Policy: sandbox`) |
| `window.storage` | same API and semantics: `get/set/delete/list(key, shared?)`, persisted per artifact |
| `window.claude.complete()` | same API (alias `window.dsh.complete`), answered by the dsh default model, rate limited |
| "Try fixing" | error bar with **Ask the agent to fix**, which sends the error into the session |
| Artifact card in the chat | live "writing… N chars" tool row; after the turn, artifact cards under the reply |
| — | an **Artifacts** page in the sidebar guide listing every artifact in the session |

## Install

Requires dsh 0.2.x (tested on `0.2.1-rc.3`), Node ≥ 24.9, and pnpm on PATH.

```sh
dsh plugin --profile web add dsh-artifacts-felix@0.1.0
dsh web
```

Alternatively, download `dsh-artifacts-felix-0.1.0.tgz` from [Releases](https://github.com/FelixJiashengFu/dsh-artifacts/releases) and run `dsh plugin --profile web add ./dsh-artifacts-felix-0.1.0.tgz`, or link a source directory after `npm ci && npm run build`.

Remove with `dsh plugin --profile web remove dsh-artifacts-felix` (when reinstalling a tarball with the same version, `remove` then `add`, since pnpm reuses its cache). The supplied source documentation reports end-to-end verification in the Web UI (`dsh web`); the desktop app was not tested and hides the "open in new tab" button. Release preparation verifies the build, types, unit tests and package contents; it does not repeat a full dsh UI test.

## Configuration

Restate the row in your profile's `cordis.patch.yml` (a patch replaces the whole `config`; omitted fields take defaults):

```yaml
- id: dsh-artifacts
  name: dsh-artifacts-felix
  config:
    cdn:
      npm: https://fastly.jsdelivr.net/npm
    ai:
      maxCallsPerMinute: 10
```

| Field | Default | Meaning |
|---|---|---|
| `dataDir` | `$DSH_HOME/artifacts` | storage directory |
| `maxBytes` | 2 MiB | maximum bytes of one version |
| `autoOpen` | `true` | open artifacts as soon as the agent writes them |
| `cdn.npm` | `https://cdn.jsdelivr.net/npm` | jsDelivr-compatible npm file CDN |
| `cdn.esm` | `https://esm.sh` | esm.sh-compatible ES module CDN |
| `cdn.tailwind` | `https://cdn.tailwindcss.com` | Tailwind Play CDN script |
| `ai.enabled` | `true` | allow `window.claude.complete` |
| `ai.provider` / `ai.model` | dsh default model | model for artifact AI calls |
| `ai.maxTokens` | 4096 | output cap per call |
| `ai.maxCallsPerMinute` | 20 | per-artifact rate limit |
| `storage.maxValueBytes` | 5 MiB | per-value limit |
| `storage.maxTotalBytes` | 20 MiB | per-artifact storage limit |

## How it works

- The Host plugin registers the `artifact` tool, stores snapshots content-addressed (`blobs/<sha256>.json`) with a per-session version index, and registers authenticated routes on dsh's Connection (`/api/artifacts.list|read|view|storage|complete`), reusing its cookie authentication and Host/Origin checks.
- The Session log is the source of truth: each version is in `tool/result.meta` and in an ignorable `plugin:dsh-artifacts/version` record, so a missing index (or a fork) is rebuilt from the log — from the live Session, or from storage through `sessionQuery` — and PTC-mode calls still produce cards.
- The browser module registers an `artifact` sidebar tab type, an `artifacts` gallery page, the `artifact` tool row, and a turn-tail card list. One document builder renders previews, standalone pages and HTML downloads, each starting with a bridge script for `window.storage`, `window.claude.complete` and error reporting.

## Security

Previews run in `sandbox="allow-scripts …"` iframes **without** `allow-same-origin`; standalone pages carry a CSP `sandbox` header. Artifact code cannot reach the dsh page, cookies or `/api`. Storage and AI calls go through the host page, which accepts messages only from the tab's own iframe and scopes them to that tab's artifact. Unauthenticated route requests get 401.

## Limitations

Previews load libraries from CDNs (configurable). Tailwind uses the Play CDN. The shadcn/ui shim covers common components only. There is no public share link (download the standalone HTML instead). `shared` storage is just a second namespace in single-user dsh. dsh is a developer preview and its plugin APIs may change.

## Development

```sh
npm ci && npm run build && npm run typecheck && npm test && npm pack
```

MIT License.
