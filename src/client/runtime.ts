/**
 * Browser-side shared state: a tiny metadata cache, an update bus, Host API
 * helpers, and the theme reader. No React here; components subscribe through
 * `useSyncExternalStore`.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ArtifactMeta, ArtifactReadResult, ArtifactRecord, ArtifactSummary, ClientConfig } from '../shared/types.ts'
import { artifactAddress, DEFAULT_CDN, relativeRoute, ROUTES } from '../shared/types.ts'

/** What the tab title and the gallery need to know without fetching. */
export interface CachedMeta {
  readonly title: string
  readonly type: string
  readonly latest: number
}

export type ThemeMode = 'light' | 'dark'

type Listener = () => void

class Emitter {
  private readonly listeners = new Set<Listener>()
  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  emit(): void {
    for (const listener of [...this.listeners]) listener()
  }
}

/** Version announcement: the newest committed version of one artifact. */
export interface VersionEvent {
  readonly address: string
  readonly version: number
  /** Monotonic counter so equal versions still notify. */
  readonly seq: number
}

export class ArtifactRuntime {
  readonly config: ClientConfig
  /** Results newer than this (Host clock, ms) count as live and may auto-open. */
  readonly loadedAt = Date.now()
  private readonly metas = new Map<string, CachedMeta>()
  private readonly metaEmitter = new Emitter()
  private readonly versionEmitter = new Emitter()
  private lastVersion: VersionEvent | undefined
  private versionSeq = 0
  private readonly announced = new Set<string>()
  private readonly records = new Map<string, ArtifactRecord>()
  private readonly themeEmitter = new Emitter()
  private theme: ThemeMode

  constructor(private readonly ctx: Context) {
    const injected = (globalThis as { __DSH_ARTIFACTS_CONFIG__?: Partial<ClientConfig> }).__DSH_ARTIFACTS_CONFIG__
    this.config = {
      cdn: { ...DEFAULT_CDN, ...(injected?.cdn ?? {}) },
      ai: injected?.ai ?? true,
      autoOpen: injected?.autoOpen ?? true,
    }
    this.theme = this.readTheme()
  }

  // ── metadata cache ─────────────────────────────────────────────────────

  subscribeMeta = (listener: Listener) => this.metaEmitter.subscribe(listener)

  meta(address: string): CachedMeta | undefined {
    return this.metas.get(address)
  }

  rememberMeta(address: string, meta: CachedMeta): void {
    const previous = this.metas.get(address)
    if (previous !== undefined && previous.latest > meta.latest) return
    if (previous?.title === meta.title && previous.type === meta.type && previous.latest === meta.latest) return
    this.metas.set(address, meta)
    this.metaEmitter.emit()
  }

  // ── version bus ──────────────────────────────────────────────────────────

  subscribeVersions = (listener: Listener) => this.versionEmitter.subscribe(listener)

  latestVersionEvent = (): VersionEvent | undefined => this.lastVersion

  /**
   * Record one settled tool result. Returns true the first time a live
   * (post-load) result is seen, so the caller may auto-open it.
   */
  noteResult(callId: string, meta: ArtifactMeta, time: number): boolean {
    const address = artifactAddress(meta.sessionId, meta.id)
    this.rememberMeta(address, { title: meta.title, type: meta.type, latest: meta.version })
    if (this.announced.has(callId)) return false
    this.announced.add(callId)
    const live = time >= this.loadedAt - 3000
    if (live) {
      this.lastVersion = { address, version: meta.version, seq: ++this.versionSeq }
      this.versionEmitter.emit()
    }
    return live
  }

  // ── theme ────────────────────────────────────────────────────────────────

  subscribeTheme = (listener: Listener) => this.themeEmitter.subscribe(listener)

  themeMode = (): ThemeMode => this.theme

  refreshTheme(): void {
    const next = this.readTheme()
    if (next !== this.theme) {
      this.theme = next
      this.themeEmitter.emit()
    }
  }

  private readTheme(): ThemeMode {
    const service = this.ctx.get('theme') as { getSnapshot?: () => { active?: { colorScheme?: string } } } | undefined
    const scheme = service?.getSnapshot?.().active?.colorScheme
    if (scheme === 'dark' || scheme === 'light') return scheme
    if (typeof document !== 'undefined' && document.body) {
      const rgb = getComputedStyle(document.body).backgroundColor.match(/\d+(\.\d+)?/g)
      if (rgb && rgb.length >= 3) {
        const [r, g, b] = rgb.map(Number) as [number, number, number]
        return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128 ? 'dark' : 'light'
      }
    }
    return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }

  /** Follow theme changes from the theme service, the OS, and the DOM. */
  watchTheme(): () => void {
    const disposers: (() => void)[] = []
    const service = this.ctx.get('theme') as { subscribe?: (listener: () => void) => () => void } | undefined
    if (typeof service?.subscribe === 'function') disposers.push(service.subscribe(() => this.refreshTheme()))
    if (typeof matchMedia === 'function') {
      const query = matchMedia('(prefers-color-scheme: dark)')
      const onChange = () => this.refreshTheme()
      query.addEventListener('change', onChange)
      disposers.push(() => query.removeEventListener('change', onChange))
    }
    if (typeof MutationObserver === 'function' && typeof document !== 'undefined') {
      const observer = new MutationObserver(() => this.refreshTheme())
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
      if (document.body) observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
      disposers.push(() => observer.disconnect())
    }
    return () => { for (const dispose of disposers) dispose() }
  }

  // ── Host API ─────────────────────────────────────────────────────────────

  private async getJson<T>(path: string, params: Record<string, string | number | undefined>, signal?: AbortSignal): Promise<T> {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, String(value))
    const response = await fetch(`${relativeRoute(path)}?${query}`, { signal, credentials: 'same-origin' })
    const body = await response.json().catch(() => undefined) as (T & { error?: string }) | undefined
    if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`)
    if (body === undefined || body === null || typeof body !== 'object') throw new Error('Malformed response from the Host.')
    return body as T
  }

  async postJson<T>(path: string, payload: unknown, signal?: AbortSignal): Promise<T> {
    const response = await fetch(relativeRoute(path), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    })
    const body = await response.json().catch(() => undefined) as (T & { error?: string }) | undefined
    if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`)
    return body as T
  }

  async read(sessionId: string, id: string, version: number | undefined, signal?: AbortSignal): Promise<ArtifactReadResult> {
    const result = await this.getJson<ArtifactReadResult>(ROUTES.read, { sessionId, id, version }, signal)
    const entry = result.versions.find(v => v.version === result.version)
    if (entry) this.records.set(entry.sha, result.record)
    const last = result.versions[result.versions.length - 1]
    if (last) this.rememberMeta(artifactAddress(sessionId, id), { title: last.title, type: last.type, latest: last.version })
    return result
  }

  cachedRecord(sha: string): ArtifactRecord | undefined {
    return this.records.get(sha)
  }

  list(sessionId: string, signal?: AbortSignal): Promise<{ artifacts: ArtifactSummary[] }> {
    return this.getJson(ROUTES.list, { sessionId }, signal)
  }

  viewUrl(sessionId: string, id: string, version: number, theme: ThemeMode): string {
    const query = new URLSearchParams({ sessionId, id, version: String(version), theme })
    return `${relativeRoute(ROUTES.view)}?${query}`
  }

  /** Whether this page runs inside the desktop shell (no same-origin Host pages). */
  get desktop(): boolean {
    return (globalThis as { dshDesktop?: unknown }).dshDesktop !== undefined
  }

  /** Send a prompt into a Session, if the Session service allows it. */
  async sendToSession(sessionId: string, text: string): Promise<boolean> {
    const sessions = this.ctx.get('sessions') as {
      scope?: (id: string) => unknown
      sessionOf?: (scope: unknown) => { prompt?: (content: { type: 'text'; text: string }[], mode: 'queue' | 'steer') => Promise<{ ok: boolean }> } | undefined
    } | undefined
    const scope = sessions?.scope?.(sessionId)
    const face = scope === undefined ? undefined : sessions?.sessionOf?.(scope)
    if (typeof face?.prompt !== 'function') return false
    const result = await face.prompt([{ type: 'text', text }], 'queue')
    return result.ok
  }
}

/** Copy text to the clipboard, with a fallback for non-secure contexts. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    area.remove()
    return ok
  }
}

/** Trigger a browser download of a text file. */
export function downloadText(filename: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
