/**
 * Vocabulary shared by the Host half (tool, store, routes) and the browser
 * half (tool card, sidebar tab). Everything here is pure and browser-safe.
 */

/** Package identity; also the client module id and the sidebar implementation id. */
export const PACKAGE_ID = 'dsh-artifacts'

/** Model-facing tool name. */
export const TOOL_NAME = 'artifact'

/** Ignorable Session-log record appended for every committed version. */
export const RECORD_TYPE = 'plugin:dsh-artifacts/version'

/** Right-sidebar tab kinds. */
export const ARTIFACT_KIND = 'artifact'
export const GALLERY_KIND = 'artifacts'

/** Renderable artifact kinds. */
export const ARTIFACT_TYPES = ['html', 'react', 'svg', 'mermaid', 'markdown', 'code'] as const
export type ArtifactType = (typeof ARTIFACT_TYPES)[number]

/** Accepted spellings, including the MIME-style names Claude's artifact tool uses. */
const TYPE_ALIASES: Readonly<Record<string, ArtifactType>> = {
  'html': 'html',
  'text/html': 'html',
  'react': 'react',
  'jsx': 'react',
  'tsx': 'react',
  'application/vnd.ant.react': 'react',
  'svg': 'svg',
  'image/svg+xml': 'svg',
  'mermaid': 'mermaid',
  'application/vnd.ant.mermaid': 'mermaid',
  'markdown': 'markdown',
  'md': 'markdown',
  'text/markdown': 'markdown',
  'document': 'markdown',
  'code': 'code',
  'application/vnd.ant.code': 'code',
}

/**
 * Normalize a model-supplied type name.
 * @param value - raw type string.
 * @returns the canonical type, or undefined when unknown.
 */
export function normalizeType(value: string | undefined): ArtifactType | undefined {
  if (value === undefined) return undefined
  return TYPE_ALIASES[value.trim().toLowerCase()]
}

/** Commands the tool accepts. */
export const COMMANDS = ['create', 'update', 'rewrite'] as const
export type ArtifactCommand = (typeof COMMANDS)[number]

/** One immutable artifact snapshot (content-addressed on the Host). */
export interface ArtifactRecord {
  readonly type: ArtifactType
  readonly title: string
  /** Source language for `code` artifacts. */
  readonly language?: string | undefined
  readonly content: string
}

/** One entry of an artifact's version history within a Session. */
export interface VersionEntry {
  readonly version: number
  readonly sha: string
  readonly type: ArtifactType
  readonly title: string
  readonly language?: string | undefined
  readonly command: ArtifactCommand
  readonly callId?: string | undefined
  readonly createdAt: number
  readonly bytes: number
}

/** Canonical tool value, also persisted as `tool/result.meta` for the card. */
export interface ArtifactMeta {
  readonly sessionId: string
  readonly id: string
  readonly version: number
  readonly type: ArtifactType
  readonly title: string
  readonly language?: string | undefined
  readonly command: ArtifactCommand
  readonly sha: string
  readonly bytes: number
  readonly lines: number
}

/** Row of `api/artifacts.list`. */
export interface ArtifactSummary {
  readonly id: string
  readonly title: string
  readonly type: ArtifactType
  readonly versions: number
  readonly updatedAt: number
}

/** Body of `api/artifacts.read`. */
export interface ArtifactReadResult {
  readonly sessionId: string
  readonly id: string
  readonly version: number
  readonly versions: readonly VersionEntry[]
  readonly record: ArtifactRecord
}

/** Validate a tool-result `meta` value received over the wire. */
export function isArtifactMeta(value: unknown): value is ArtifactMeta {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.sessionId === 'string' && typeof v.id === 'string' && typeof v.version === 'number'
    && typeof v.title === 'string' && typeof v.sha === 'string' && normalizeType(v.type as string) !== undefined
}

/** Identifier rule: short, URL-safe, stable across updates. */
export const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i

/** Resource address prefix claimed by the artifact tab type. */
export const ADDRESS_PREFIX = 'dsh-resource://artifact/'

/**
 * Compose the sidebar resource address of one artifact (version-free, so
 * reopening focuses the existing tab).
 */
export function artifactAddress(sessionId: string, id: string): string {
  return `${ADDRESS_PREFIX}${encodeURIComponent(sessionId)}/${encodeURIComponent(id)}`
}

/** Parse an artifact address; undefined when it is not one. */
export function parseArtifactAddress(address: string): { sessionId: string; id: string } | undefined {
  if (!address.startsWith(ADDRESS_PREFIX)) return undefined
  const rest = address.slice(ADDRESS_PREFIX.length).split('?')[0]!.split('#')[0]!
  const parts = rest.split('/')
  if (parts.length !== 2 || parts[0] === '' || parts[1] === '') return undefined
  try {
    return { sessionId: decodeURIComponent(parts[0]!), id: decodeURIComponent(parts[1]!) }
  } catch {
    return undefined
  }
}

/** Authenticated Host routes (absolute form; the browser uses the document-relative form). */
export const ROUTES = {
  list: '/api/artifacts.list',
  read: '/api/artifacts.read',
  view: '/api/artifacts.view',
  storage: '/api/artifacts.storage',
  complete: '/api/artifacts.complete',
} as const

/** Browser-relative route (DSH serves the app under arbitrary mounts). */
export function relativeRoute(path: string): string {
  return path.startsWith('/') ? path.slice(1) : path
}

/** CDN bases used inside the sandboxed iframe. */
export interface CdnConfig {
  /** npm file CDN (jsDelivr-compatible: `<base>/<pkg>@<ver>/<path>`). */
  readonly npm: string
  /** ES module CDN (esm.sh-compatible: `<base>/<pkg>?external=react,react-dom`). */
  readonly esm: string
  /** Tailwind Play CDN script URL. */
  readonly tailwind: string
}

export const DEFAULT_CDN: CdnConfig = {
  npm: 'https://cdn.jsdelivr.net/npm',
  esm: 'https://esm.sh',
  tailwind: 'https://cdn.tailwindcss.com',
}

/** Browser-visible configuration injected by the Host into the page. */
export interface ClientConfig {
  readonly cdn: CdnConfig
  readonly ai: boolean
  readonly autoOpen: boolean
}

/** File extension used when downloading an artifact's source. */
export function sourceExtension(record: Pick<ArtifactRecord, 'type' | 'language'>): string {
  switch (record.type) {
    case 'html': return 'html'
    case 'react': return 'jsx'
    case 'svg': return 'svg'
    case 'mermaid': return 'mmd'
    case 'markdown': return 'md'
    case 'code': return codeExtension(record.language)
  }
}

const CODE_EXTENSIONS: Readonly<Record<string, string>> = {
  python: 'py', py: 'py', javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts', tsx: 'tsx', jsx: 'jsx',
  java: 'java', c: 'c', cpp: 'cpp', 'c++': 'cpp', csharp: 'cs', 'c#': 'cs', go: 'go', rust: 'rs', ruby: 'rb',
  php: 'php', swift: 'swift', kotlin: 'kt', scala: 'scala', r: 'r', matlab: 'm', julia: 'jl', lua: 'lua',
  shell: 'sh', bash: 'sh', sh: 'sh', zsh: 'sh', powershell: 'ps1', sql: 'sql', html: 'html', css: 'css',
  scss: 'scss', json: 'json', yaml: 'yaml', yml: 'yml', toml: 'toml', xml: 'xml', markdown: 'md',
  latex: 'tex', tex: 'tex', dart: 'dart', haskell: 'hs', elixir: 'ex', fortran: 'f90', dockerfile: 'Dockerfile',
}

function codeExtension(language: string | undefined): string {
  return (language && CODE_EXTENSIONS[language.toLowerCase()]) || 'txt'
}

/** Short human label per type. */
export const TYPE_LABEL: Readonly<Record<ArtifactType, string>> = {
  html: 'HTML',
  react: 'React',
  svg: 'SVG',
  mermaid: 'Mermaid',
  markdown: 'Document',
  code: 'Code',
}
