/**
 * Durable per-version records in the Session log.
 *
 * Each committed version is also appended as an ignorable plugin record
 * (`plugin:dsh-artifacts/version`). Records reach the browser with the rest
 * of the log, so the conversation can list artifacts even when the tool was
 * called from code (PTC mode, where nested calls have no `tool/call` event),
 * and forks/resumes carry them. Older harnesses without the plugin-record API
 * simply skip this step.
 */
import * as sessionApi from '@deepseek-ai/dsh-session'
import type { ArtifactMeta } from '../shared/types.ts'
import { RECORD_TYPE } from '../shared/types.ts'

/** Minimal Session surface used to find the open turn. */
interface SessionLike {
  readonly seq?: number
  eventAt?(seq: number): { readonly type: string; readonly data?: unknown } | undefined
  snapshotEvents?(): readonly { readonly type: string; readonly data?: unknown }[]
}

/** The number of the latest turn started in this Session log, if any. */
export function currentTurn(session: SessionLike): number | undefined {
  const turnOf = (event: { type: string; data?: unknown } | undefined): number | undefined => {
    if (event?.type !== 'turn/start') return undefined
    const turn = (event.data as { turn?: unknown } | undefined)?.turn
    return typeof turn === 'number' ? turn : undefined
  }
  if (typeof session.eventAt === 'function' && typeof session.seq === 'number') {
    for (let seq = session.seq - 1; seq >= 0; seq -= 1) {
      let event
      try {
        event = session.eventAt(seq)
      } catch {
        break
      }
      if (event === undefined) break
      const turn = turnOf(event)
      if (turn !== undefined) return turn
    }
  }
  const events = session.snapshotEvents?.() ?? []
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const turn = turnOf(events[i])
    if (turn !== undefined) return turn
  }
  return undefined
}

/** Payload of one record. */
export type VersionRecord = ArtifactMeta & { readonly turn: number; readonly callId: string }

/**
 * Append one version record. Never throws: the record is an enhancement.
 * @returns whether the record was written.
 */
export function appendVersionRecord(session: unknown, record: VersionRecord): boolean {
  const append = (sessionApi as unknown as { appendPluginRecord?: (s: unknown, type: string, data: unknown) => unknown }).appendPluginRecord
  if (typeof append !== 'function') return false
  try {
    append(session, RECORD_TYPE, record)
    return true
  } catch {
    return false
  }
}
