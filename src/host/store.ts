/**
 * Artifact persistence on the Host.
 *
 * - Snapshots are content-addressed JSON blobs (`blobs/ab/<sha256>.json`), so
 *   every version referenced by any Session log stays readable forever and
 *   identical content is stored once.
 * - Each Session keeps an index (`sessions/<sessionId>.json`) of artifact ids
 *   to their ordered versions. The index is a cache of what the Session log
 *   already records in `tool/result.meta`; a forked or migrated Session whose
 *   index is missing rebuilds it from its own log on first use.
 * - Artifact runtime storage (`window.storage`) lives in `kv/<sessionId>/…`.
 */
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ArtifactMeta, ArtifactRecord, ArtifactSummary, VersionEntry } from '../shared/types.ts'
import { isArtifactMeta, normalizeType, RECORD_TYPE, TOOL_NAME } from '../shared/types.ts'

interface SessionIndex {
  readonly format: 1
  artifacts: Record<string, VersionEntry[]>
}

interface KvFile {
  personal: Record<string, string>
  shared: Record<string, string>
}

/** Minimal view of a Session log entry this store needs for rebuilding. */
export interface LogEvent {
  readonly type: string
  readonly time?: number
  readonly data?: unknown
}

/** Reads a Session's log on demand (synchronously for live Sessions, asynchronously from storage). */
export type LogReader = () => readonly LogEvent[] | Promise<readonly LogEvent[]>

const SAFE_SEGMENT = /[^A-Za-z0-9._-]/g

function safeSegment(value: string): string {
  const cleaned = value.replace(SAFE_SEGMENT, '_')
  // Keep names unique even when sanitizing collapses characters.
  return cleaned === value ? value : `${cleaned}-${createHash('sha1').update(value).digest('hex').slice(0, 8)}`
}

/** Canonical bytes of a record: stable key order, so equal content hashes equally. */
export function canonicalRecord(record: ArtifactRecord): string {
  return JSON.stringify({
    type: record.type,
    title: record.title,
    ...(record.language === undefined ? {} : { language: record.language }),
    content: record.content,
  })
}

export function recordSha(record: ArtifactRecord): string {
  return createHash('sha256').update(canonicalRecord(record)).digest('hex')
}

async function atomicWrite(path: string, data: string): Promise<void> {
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(tmp, data, 'utf8')
  await rename(tmp, path)
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export class ArtifactStore {
  private readonly indexes = new Map<string, SessionIndex>()
  private readonly queues = new Map<string, Promise<unknown>>()
  private readonly blobCache = new Map<string, ArtifactRecord>()

  constructor(readonly root: string) {}

  /** Serialize work per key (a Session, or a Session's kv file). */
  serialize<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve()
    const next = previous.then(task, task)
    const settled = next.then(() => undefined, () => undefined)
    this.queues.set(key, settled)
    void settled.then(() => {
      if (this.queues.get(key) === settled) this.queues.delete(key)
    })
    return next
  }

  // ── blobs ────────────────────────────────────────────────────────────────

  private blobPath(sha: string): string {
    return join(this.root, 'blobs', sha.slice(0, 2), `${sha}.json`)
  }

  async putBlob(record: ArtifactRecord): Promise<string> {
    const sha = recordSha(record)
    if (this.blobCache.has(sha)) return sha
    const path = this.blobPath(sha)
    await mkdir(join(this.root, 'blobs', sha.slice(0, 2)), { recursive: true })
    const existing = await readJson<ArtifactRecord>(path)
    if (existing === undefined) await atomicWrite(path, canonicalRecord(record))
    this.remember(sha, record)
    return sha
  }

  async getBlob(sha: string): Promise<ArtifactRecord | undefined> {
    if (!/^[a-f0-9]{64}$/.test(sha)) return undefined
    const cached = this.blobCache.get(sha)
    if (cached !== undefined) return cached
    const raw = await readJson<Record<string, unknown>>(this.blobPath(sha))
    if (raw === undefined) return undefined
    const type = normalizeType(raw.type as string)
    if (type === undefined || typeof raw.title !== 'string' || typeof raw.content !== 'string') return undefined
    const record: ArtifactRecord = {
      type,
      title: raw.title,
      content: raw.content,
      ...(typeof raw.language === 'string' ? { language: raw.language } : {}),
    }
    this.remember(sha, record)
    return record
  }

  private remember(sha: string, record: ArtifactRecord): void {
    this.blobCache.set(sha, record)
    // Bounded cache: drop the oldest entries beyond 256 records.
    while (this.blobCache.size > 256) {
      const first = this.blobCache.keys().next().value
      if (first === undefined) break
      this.blobCache.delete(first)
    }
  }

  // ── session index ────────────────────────────────────────────────────────

  private indexPath(sessionId: string): string {
    return join(this.root, 'sessions', `${safeSegment(sessionId)}.json`)
  }

  private async loadIndex(sessionId: string): Promise<SessionIndex | undefined> {
    const cached = this.indexes.get(sessionId)
    if (cached !== undefined) return cached
    const stored = await readJson<SessionIndex>(this.indexPath(sessionId))
    if (stored === undefined || stored.format !== 1 || typeof stored.artifacts !== 'object') return undefined
    this.indexes.set(sessionId, stored)
    return stored
  }

  private async saveIndex(sessionId: string, index: SessionIndex): Promise<void> {
    this.indexes.set(sessionId, index)
    await mkdir(join(this.root, 'sessions'), { recursive: true })
    await atomicWrite(this.indexPath(sessionId), JSON.stringify(index))
  }

  /**
   * Rebuild a Session's index from the artifact tool results in its log.
   * Used when a Session (typically a fork) has no index file yet.
   */
  static indexFromLog(events: readonly LogEvent[]): SessionIndex {
    const index: SessionIndex = { format: 1, artifacts: {} }
    const callNames = new Map<string, string>()
    for (const event of events) {
      if (event.type === 'tool/call') {
        const data = event.data as { callId?: string; name?: string } | undefined
        if (data?.callId !== undefined && data.name !== undefined) callNames.set(data.callId, data.name)
        continue
      }
      if (event.type === RECORD_TYPE) {
        const record = event.data as (ArtifactMeta & { callId?: string }) | undefined
        if (!isArtifactMeta(record)) continue
        const versions = index.artifacts[record.id] ?? (index.artifacts[record.id] = [])
        if (!versions.some(v => v.version === record.version)) versions.push(entryFromMeta(record, record.callId, event.time ?? 0))
        continue
      }
      if (event.type !== 'tool/result') continue
      const data = event.data as { message?: { toolCallId?: string; isError?: boolean }; meta?: unknown } | undefined
      const meta = data?.meta
      if (!isArtifactMeta(meta) || data?.message?.isError === true) continue
      const callId = data?.message?.toolCallId
      if (callId !== undefined && callNames.has(callId) && callNames.get(callId) !== TOOL_NAME) continue
      const versions = index.artifacts[meta.id] ?? (index.artifacts[meta.id] = [])
      if (versions.some(v => v.version === meta.version)) continue
      versions.push(entryFromMeta(meta, callId, event.time ?? 0))
    }
    for (const versions of Object.values(index.artifacts)) versions.sort((a, b) => a.version - b.version)
    return index
  }

  /**
   * Read (and lazily rebuild) a Session's index.
   * @param sessionId - Session identity.
   * @param log - reader for the Session log, used only when no index exists.
   */
  async index(sessionId: string, log?: LogReader): Promise<SessionIndex> {
    const existing = await this.loadIndex(sessionId)
    if (existing !== undefined && (log === undefined || Object.keys(existing.artifacts).length > 0)) return existing
    let events: readonly LogEvent[] = []
    if (log !== undefined) {
      try {
        events = await log()
      } catch {
        events = []
      }
    }
    const rebuilt = ArtifactStore.indexFromLog(events)
    // Persist only what the log proves; an empty result stays uncached so a later caller with a log can rebuild.
    if (Object.keys(rebuilt.artifacts).length > 0) await this.saveIndex(sessionId, rebuilt)
    return rebuilt
  }

  async history(sessionId: string, id: string, log?: LogReader): Promise<readonly VersionEntry[]> {
    const index = await this.index(sessionId, log)
    return index.artifacts[id] ?? []
  }

  async list(sessionId: string): Promise<ArtifactSummary[]> {
    const index = await this.index(sessionId)
    return Object.entries(index.artifacts)
      .filter(([, versions]) => versions.length > 0)
      .map(([id, versions]) => {
        const last = versions[versions.length - 1]!
        return { id, title: last.title, type: last.type, versions: versions.length, updatedAt: last.createdAt }
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /** Append a committed version to the Session index. Call inside {@link serialize}. */
  async appendVersion(sessionId: string, id: string, entry: VersionEntry, log?: LogReader): Promise<void> {
    const index = await this.index(sessionId, log)
    const versions = index.artifacts[id] ?? (index.artifacts[id] = [])
    versions.push(entry)
    await this.saveIndex(sessionId, index)
  }

  // ── runtime key/value storage ────────────────────────────────────────────

  private kvPath(sessionId: string, id: string): string {
    return join(this.root, 'kv', safeSegment(sessionId), `${safeSegment(id)}.json`)
  }

  async kv<T>(sessionId: string, id: string, mutate: (file: KvFile) => T): Promise<T> {
    const path = this.kvPath(sessionId, id)
    return this.serialize(`kv:${path}`, async () => {
      const file = (await readJson<KvFile>(path)) ?? { personal: {}, shared: {} }
      file.personal ??= {}
      file.shared ??= {}
      const before = JSON.stringify(file)
      const result = mutate(file)
      const after = JSON.stringify(file)
      if (after !== before) {
        await mkdir(join(this.root, 'kv', safeSegment(sessionId)), { recursive: true })
        await atomicWrite(path, after)
      }
      return result
    })
  }
}

/** Build an index entry from a tool-result meta. */
export function entryFromMeta(meta: ArtifactMeta, callId: string | undefined, createdAt: number): VersionEntry {
  return {
    version: meta.version,
    sha: meta.sha,
    type: meta.type,
    title: meta.title,
    ...(meta.language === undefined ? {} : { language: meta.language }),
    command: meta.command,
    ...(callId === undefined ? {} : { callId }),
    createdAt,
    bytes: meta.bytes,
  }
}
