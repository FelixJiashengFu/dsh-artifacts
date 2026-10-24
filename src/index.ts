/**
 * dsh-artifacts — Claude-style Artifacts for DeepSeek Harness.
 *
 * Host half: the model-facing `artifact` tool, versioned artifact storage,
 * authenticated routes for the browser (read, standalone view, runtime
 * storage, AI completion), and the page config the browser half reads.
 * The browser half ships as `exports["./client"]` and is discovered through
 * this package's `dsh.client` declaration.
 */
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ClientConfig } from './shared/types.ts'
import { DEFAULT_CDN } from './shared/types.ts'
import { ArtifactStore, type LogEvent, type LogReader } from './host/store.ts'
import { createArtifactTool } from './host/tool.ts'
import { ArtifactAi } from './host/ai.ts'
import { registerRoutes } from './host/routes.ts'
import { appendVersionRecord, currentTurn, type VersionRecord } from './host/records.ts'

export const name = 'dsh-artifacts'

/** Plugin configuration (all fields optional in `cordis.yml`). */
export interface Config {
  /** Where artifacts are stored. Default: `$DSH_HOME/artifacts` (`~/.dsh/artifacts`). */
  dataDir?: string | undefined
  /** Maximum UTF-8 bytes of one artifact version. */
  maxBytes: number
  /** Open new or updated artifacts in the side panel automatically. */
  autoOpen: boolean
  /** CDN bases used inside the sandboxed preview. */
  cdn: { npm: string; esm: string; tailwind: string }
  /** `window.claude.complete` for artifacts. */
  ai: {
    enabled: boolean
    provider?: string | undefined
    model?: string | undefined
    maxTokens: number
    maxPromptChars: number
    maxCallsPerMinute: number
    timeoutMs: number
  }
  /** `window.storage` limits per artifact. */
  storage: { maxKeyLength: number; maxValueBytes: number; maxTotalBytes: number }
}

const httpsUrl = z.string().pattern(/^https?:\/\/\S+$/)

export const Config: z<Partial<Config>, Config> = z.object({
  dataDir: z.string().description('Artifact storage directory. Default: $DSH_HOME/artifacts.'),
  maxBytes: z.natural().min(1024).default(2 * 1024 * 1024).description('Maximum bytes of one artifact version.'),
  autoOpen: z.boolean().default(true).description('Open artifacts in the side panel as soon as the agent writes them.'),
  cdn: z.object({
    npm: httpsUrl.default(DEFAULT_CDN.npm).description('npm file CDN (jsDelivr-compatible), e.g. https://fastly.jsdelivr.net/npm'),
    esm: httpsUrl.default(DEFAULT_CDN.esm).description('ES module CDN (esm.sh-compatible) for React artifact imports.'),
    tailwind: httpsUrl.default(DEFAULT_CDN.tailwind).description('Tailwind Play CDN script URL.'),
  }),
  ai: z.object({
    enabled: z.boolean().default(true).description('Let artifacts call the model through window.claude.complete.'),
    provider: z.string().description('Provider for artifact AI calls. Default: the deployment default model.'),
    model: z.string().description('Model for artifact AI calls. Default: the deployment default model.'),
    maxTokens: z.natural().min(1).default(4096),
    maxPromptChars: z.natural().min(1).default(200_000),
    maxCallsPerMinute: z.natural().min(1).default(20),
    timeoutMs: z.natural().min(1000).default(120_000),
  }),
  storage: z.object({
    maxKeyLength: z.natural().min(1).default(200),
    maxValueBytes: z.natural().min(1).default(5 * 1024 * 1024),
    maxTotalBytes: z.natural().min(1).default(20 * 1024 * 1024),
  }),
}) as unknown as z<Partial<Config>, Config>

/** Required services: only the tool registry. Routes attach when Connection exists. */
export const inject = ['tools']

/** Resolve the DSH home the same way the harness does: $DSH_HOME, else ~/.dsh. */
export function resolveDataDir(configured: string | undefined): string {
  const expand = (p: string) => (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) ? join(homedir(), p.slice(1)) : p
  if (configured && configured.trim()) return resolve(expand(configured.trim()))
  const env = process.env.DSH_HOME?.trim()
  return join(env ? resolve(expand(env)) : join(homedir(), '.dsh'), 'artifacts')
}

export function apply(ctx: Context, config: Config): void {
  const store = new ArtifactStore(resolveDataDir(config.dataDir))
  const ai = new ArtifactAi(ctx, config.ai)
  const tools = (ctx as unknown as { tools: { register(definition: unknown): unknown } }).tools
  // Versions committed by an execution, recorded into its Session log once the call succeeds.
  const pending = new WeakMap<object, { session: unknown; record: VersionRecord }>()
  tools.register(createArtifactTool(store, {
    maxBytes: config.maxBytes,
    ai: config.ai.enabled,
    onCommitted: (exec, meta, session) => {
      const turn = currentTurn(session as Parameters<typeof currentTurn>[0])
      const callId = (exec as { callId?: unknown }).callId
      if (turn !== undefined) pending.set(exec, { session, record: { ...meta, turn, callId: String(callId) } })
    },
  }))
  ;(ctx as unknown as { on(event: string, listener: (exec: object, result: { isError: boolean }) => void): void }).on('tools/result', (exec, result) => {
    const entry = pending.get(exec)
    if (entry === undefined) return
    pending.delete(exec)
    if (!result.isError) appendVersionRecord(entry.session, entry.record)
  })

  // A Session's own log can rebuild a missing index file: the live Session when it is
  // running, otherwise the stored log read through session-query (without making it live).
  const logFor = (sessionId: string): LogReader | undefined => {
    const agents = ctx.get('agents') as { get?: (id: string) => { session?: { snapshotEvents?: () => readonly LogEvent[] } } | undefined } | undefined
    const session = agents?.get?.(sessionId)?.session
    if (typeof session?.snapshotEvents === 'function') return () => session.snapshotEvents!()
    const query = ctx.get('sessionQuery') as { readSession?: (id: string) => Promise<{ events: readonly LogEvent[] }> } | undefined
    if (typeof query?.readSession === 'function') return async () => (await query.readSession!(sessionId)).events
    return undefined
  }
  ctx.inject(['connection'], (scope) => {
    registerRoutes(scope, store, ai, { cdn: config.cdn, storage: config.storage, logFor })
  })

  const clientConfig: ClientConfig = { cdn: config.cdn, ai: config.ai.enabled, autoOpen: config.autoOpen }
  ;(ctx as unknown as { on(event: string, listener: (table: unknown[]) => void): void }).on('webserver/index-inject', (table) => {
    table.push({ kind: 'global', name: '__DSH_ARTIFACTS_CONFIG__', value: clientConfig })
  })
}
