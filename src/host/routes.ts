/**
 * Authenticated browser routes. They register on Connection's exact-route
 * table, so the carrier applies its Host/Origin checks and cookie
 * authentication before any handler runs, and only the owner reaches them.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ArtifactReadResult, CdnConfig, VersionEntry } from '../shared/types.ts'
import { ROUTES } from '../shared/types.ts'
import { buildDocument } from '../shared/document.ts'
import type { ArtifactStore, LogReader } from './store.ts'
import type { ArtifactAi } from './ai.ts'

interface ConnectionLike {
  readonly fetch: {
    register(route: {
      readonly path: string
      readonly methods: readonly ('GET' | 'HEAD' | 'POST')[]
      readonly requestBody: 'buffered' | 'streaming'
      readonly fetch: (request: Request) => Promise<Response>
    }): () => Promise<void>
  }
}

export interface RouteOptions {
  /** Session log reader for live Sessions, used when an index file is missing. */
  readonly logFor?: ((sessionId: string) => LogReader | undefined) | undefined
  readonly cdn: CdnConfig
  readonly storage: { readonly maxKeyLength: number; readonly maxValueBytes: number; readonly maxTotalBytes: number }
}

const NO_STORE = { 'cache-control': 'no-store' }

/** CSP that forces the standalone page into an opaque origin. */
export const VIEW_CSP = 'sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-downloads'

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: NO_STORE })
}

function fail(status: number, message: string): Response {
  return json({ error: message }, status)
}

async function body(request: Request): Promise<Record<string, unknown> | undefined> {
  try {
    const value: unknown = await request.json()
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

function pick(versions: readonly VersionEntry[], raw: string | null): VersionEntry | undefined {
  if (raw === null || raw === '' || raw === 'latest') return versions[versions.length - 1]
  const n = Number(raw)
  return Number.isSafeInteger(n) ? versions.find(v => v.version === n) : undefined
}

/**
 * Register every route. Each registration is an effect of `ctx`.
 * @param ctx - context that has `connection` injected.
 */
export function registerRoutes(ctx: Context, store: ArtifactStore, ai: ArtifactAi, options: RouteOptions): void {
  const connection = (ctx as unknown as { connection: ConnectionLike }).connection
  const route = (path: string, methods: ('GET' | 'HEAD' | 'POST')[], handler: (request: Request) => Promise<Response>): void => {
    ctx.effect(() => connection.fetch.register({
      path,
      methods,
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          return await handler(request)
        } catch (error) {
          if (request.signal.aborted) return fail(499, 'cancelled')
          return fail(500, error instanceof Error ? error.message : String(error))
        }
      },
    }), `dsh-artifacts: ${path}`)
  }

  async function read(url: URL): Promise<ArtifactReadResult | Response> {
    const sessionId = url.searchParams.get('sessionId')
    const id = url.searchParams.get('id')
    if (!sessionId || !id) return fail(400, 'sessionId and id are required')
    const versions = await store.history(sessionId, id, options.logFor?.(sessionId))
    if (versions.length === 0) return fail(404, `no artifact "${id}" in this session`)
    const entry = pick(versions, url.searchParams.get('version'))
    if (entry === undefined) return fail(404, 'no such version')
    const record = await store.getBlob(entry.sha)
    if (record === undefined) return fail(410, 'artifact content is missing on disk')
    return { sessionId, id, version: entry.version, versions, record }
  }

  route(ROUTES.list, ['GET'], async (request) => {
    const sessionId = new URL(request.url).searchParams.get('sessionId')
    if (!sessionId) return fail(400, 'sessionId is required')
    return json({ artifacts: await store.list(sessionId) })
  })

  route(ROUTES.read, ['GET'], async (request) => {
    const result = await read(new URL(request.url))
    return result instanceof Response ? result : json(result)
  })

  route(ROUTES.view, ['GET', 'HEAD'], async (request) => {
    const url = new URL(request.url)
    const result = await read(url)
    if (result instanceof Response) return result
    const theme = url.searchParams.get('theme') === 'dark' ? 'dark' : 'light'
    const html = buildDocument(result.record, { cdn: options.cdn, theme })
    return new Response(request.method === 'HEAD' ? null : html, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': VIEW_CSP,
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        ...NO_STORE,
      },
    })
  })

  route(ROUTES.storage, ['POST'], async (request) => {
    const input = await body(request)
    if (input === undefined) return fail(400, 'expected a JSON object')
    const { sessionId, id, op } = input
    if (typeof sessionId !== 'string' || typeof id !== 'string' || typeof op !== 'string') return fail(400, 'sessionId, id and op are required')
    const shared = input.shared === true
    const key = typeof input.key === 'string' ? input.key : undefined
    const limits = options.storage
    if (op !== 'list' && (key === undefined || key.length === 0 || key.length > limits.maxKeyLength)) {
      return fail(400, `key must be a non-empty string of at most ${limits.maxKeyLength} characters`)
    }
    switch (op) {
      case 'get':
        return json(await store.kv(sessionId, id, (file) => {
          const bucket = shared ? file.shared : file.personal
          return Object.prototype.hasOwnProperty.call(bucket, key!) ? { key, value: bucket[key!], shared } : null
        }))
      case 'set': {
        if (typeof input.value !== 'string') return fail(400, 'value must be a string')
        const value = input.value
        if (Buffer.byteLength(value, 'utf8') > limits.maxValueBytes) return fail(413, `value exceeds ${limits.maxValueBytes} bytes`)
        const outcome = await store.kv(sessionId, id, (file) => {
          const bucket = shared ? file.shared : file.personal
          const previous = bucket[key!]
          bucket[key!] = value
          if (Buffer.byteLength(JSON.stringify(file), 'utf8') > limits.maxTotalBytes) {
            if (previous === undefined) delete bucket[key!]
            else bucket[key!] = previous
            return undefined
          }
          return { key, value, shared }
        })
        return outcome === undefined ? fail(413, `artifact storage exceeds ${limits.maxTotalBytes} bytes`) : json(outcome)
      }
      case 'delete':
        return json(await store.kv(sessionId, id, (file) => {
          const bucket = shared ? file.shared : file.personal
          const had = Object.prototype.hasOwnProperty.call(bucket, key!)
          delete bucket[key!]
          return { key, deleted: had, shared }
        }))
      case 'list': {
        const prefix = typeof input.prefix === 'string' ? input.prefix : undefined
        return json(await store.kv(sessionId, id, (file) => {
          const bucket = shared ? file.shared : file.personal
          const keys = Object.keys(bucket).filter(k => prefix === undefined || k.startsWith(prefix))
          return { keys, ...(prefix === undefined ? {} : { prefix }), shared }
        }))
      }
      default:
        return fail(400, `unknown storage op "${op}"`)
    }
  })

  route(ROUTES.complete, ['POST'], async (request) => {
    const input = await body(request)
    if (input === undefined) return fail(400, 'expected a JSON object')
    const { sessionId, id } = input
    if (typeof sessionId !== 'string' || typeof id !== 'string') return fail(400, 'sessionId and id are required')
    if (!ai.enabled) return fail(403, 'AI calls from artifacts are disabled in this deployment.')
    try {
      const text = await ai.complete(sessionId, id, input.prompt, request.signal)
      return json({ text })
    } catch (error) {
      if (request.signal.aborted) return fail(499, 'cancelled')
      return fail(error instanceof Error && error.message.startsWith('Rate limit') ? 429 : 502, error instanceof Error ? error.message : String(error))
    }
  })
}
