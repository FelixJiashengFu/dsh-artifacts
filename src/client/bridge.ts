/**
 * Host-page side of the iframe bridge. The iframe never names its own
 * artifact: the page binds every call to the artifact shown in the tab, so a
 * document cannot reach another artifact's storage.
 */
import { ROUTES } from '../shared/types.ts'
import type { ArtifactRuntime } from './runtime.ts'

export interface BridgeTarget {
  readonly sessionId: string
  readonly id: string
}

export interface RuntimeErrorReport {
  readonly kind: string
  readonly message: string
  readonly stack?: string | undefined
}

const STORAGE_OPS = new Set(['get', 'set', 'delete', 'list'])

/** Run one bridged call and return the value the iframe receives. */
export async function handleCall(runtime: ArtifactRuntime, target: BridgeTarget, op: unknown, payload: unknown): Promise<unknown> {
  if (typeof op !== 'string') throw new Error('Malformed request.')
  const input = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>
  if (op.startsWith('storage.')) {
    const name = op.slice('storage.'.length)
    if (!STORAGE_OPS.has(name)) throw new Error(`Unknown storage operation "${name}".`)
    return runtime.postJson(ROUTES.storage, {
      sessionId: target.sessionId,
      id: target.id,
      op: name,
      key: typeof input.key === 'string' ? input.key : undefined,
      value: typeof input.value === 'string' ? input.value : undefined,
      prefix: typeof input.prefix === 'string' ? input.prefix : undefined,
      shared: input.shared === true,
    })
  }
  if (op === 'complete') {
    if (!runtime.config.ai) throw new Error('AI calls from artifacts are disabled in this deployment.')
    return runtime.postJson(ROUTES.complete, { sessionId: target.sessionId, id: target.id, prompt: input.prompt })
  }
  throw new Error(`Unknown operation "${op}".`)
}

/** Validate an error report posted by the iframe. */
export function errorReport(value: unknown): RuntimeErrorReport | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const v = value as Record<string, unknown>
  if (typeof v.message !== 'string') return undefined
  return {
    kind: typeof v.kind === 'string' ? v.kind.slice(0, 32) : 'runtime',
    message: v.message.slice(0, 4000),
    ...(typeof v.stack === 'string' ? { stack: v.stack.slice(0, 8000) } : {}),
  }
}
