/**
 * Turn-level artifact cards. A finished turn's tool rows fold into its
 * process summary, so — as Claude shows artifacts beside its reply — the
 * artifacts a turn produced are also listed in the turn tail, after the
 * closing message. The Definition folds each turn's successful `artifact`
 * results (latest version per id) from the Session log.
 */
import { useEffect, type ReactNode } from 'react'
import type { ArtifactMeta } from '../shared/types.ts'
import { isArtifactMeta, RECORD_TYPE, TOOL_NAME } from '../shared/types.ts'
import type { ArtifactRuntime } from './runtime.ts'
import type { ArtifactsKey } from './locales.ts'
import type { OpenArtifact } from './ArtifactCard.tsx'
import { TypeGlyph } from './icons.tsx'

type Translate = (key: ArtifactsKey, params?: Record<string, unknown>) => string

/** One artifact a turn produced (its latest version in that turn). */
export interface TurnArtifact {
  readonly meta: ArtifactMeta
  readonly callId: string
  readonly time: number
}

export interface ArtifactsTurnData {
  readonly artifacts: readonly TurnArtifact[]
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationTurnDataMap {
    /** Artifacts written in this turn, latest version per id. */
    dshArtifacts: ArtifactsTurnData
  }
}

interface State {
  readonly turn: number
  readonly calls: ReadonlySet<string>
  readonly artifacts: readonly TurnArtifact[]
}

interface EventLike {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: Record<string, unknown> & { turn?: number }
}

interface MatchLike { readonly event: EventLike }
interface ContextLike { readonly state: State }

function resultCallId(data: Record<string, unknown>): string | undefined {
  const message = data.message as { source?: { callId?: unknown }; toolCallId?: unknown } | undefined
  const id = message?.source?.callId ?? message?.toolCallId
  return id === undefined ? undefined : String(id)
}

/** Keep the newest version of each artifact; tool results and records may both report one version. */
function withEntry(state: State, entry: TurnArtifact): State {
  const existing = state.artifacts.find(a => a.meta.id === entry.meta.id && a.meta.sessionId === entry.meta.sessionId)
  if (existing !== undefined && existing.meta.version >= entry.meta.version) return state
  return { ...state, artifacts: [...state.artifacts.filter(a => a !== existing), entry] }
}

/** The ConversationNodeDefinition registered on `ctx.uiConversation.events`. */
export const artifactsDefinition = {
  kind: 'dshArtifacts',
  match: (event: EventLike) => {
    const turn = event.data?.turn
    if (typeof turn !== 'number') return null
    if (event.type === 'turn/start') return { id: String(turn), role: 'start' as const }
    if (event.type === 'tool/call' && event.data.name === TOOL_NAME) return { id: String(turn), role: 'update' as const }
    if (event.type === 'tool/result' && isArtifactMeta(event.data.meta)) return { id: String(turn), role: 'update' as const }
    if (event.type === RECORD_TYPE && isArtifactMeta(event.data)) return { id: String(turn), role: 'update' as const }
    return null
  },
  start: (_context: unknown, match: MatchLike): State => {
    if (match.event.type !== 'turn/start') throw new Error('dshArtifacts start requires turn/start')
    return { turn: match.event.data.turn as number, calls: new Set(), artifacts: [] }
  },
  update: (context: ContextLike, match: MatchLike): State => {
    const { event } = match
    const state = context.state
    if (event.type === 'tool/call') {
      const calls = new Set(state.calls)
      calls.add(String(event.data.callId))
      return { ...state, calls }
    }
    if (event.type === RECORD_TYPE) {
      const record = event.data as unknown
      if (!isArtifactMeta(record)) return state
      return withEntry(state, { meta: record, callId: String((event.data as { callId?: unknown }).callId ?? `seq:${event.seq}`), time: event.time })
    }
    if (event.type !== 'tool/result') return state
    const message = event.data.message as { isError?: boolean } | undefined
    if (message?.isError === true || !isArtifactMeta(event.data.meta)) return state
    const callId = resultCallId(event.data)
    if (callId === undefined || !state.calls.has(callId)) return state
    return withEntry(state, { meta: event.data.meta, callId, time: event.time })
  },
  buildLocationData: (context: { state: State | undefined }, scope: string, previous: { kind?: string; turn?: number; key?: string; value?: ArtifactsTurnData } | null) => {
    const state = context.state
    if (scope !== 'turn' || state === undefined || state.artifacts.length === 0) return null
    if (previous?.kind === 'turn' && previous.turn === state.turn && previous.key === 'dshArtifacts'
      && previous.value?.artifacts === state.artifacts) return previous
    return { kind: 'turn', turn: state.turn, key: 'dshArtifacts', value: { artifacts: state.artifacts } }
  },
}

interface TailProps {
  readonly turn: { readonly data: { get(key: string): unknown } }
  readonly t: Translate
}

function TailCard({ item, runtime, open, t }: { item: TurnArtifact; runtime: ArtifactRuntime; open: OpenArtifact; t: Translate }): ReactNode {
  const { meta } = item
  useEffect(() => {
    const live = runtime.noteResult(item.callId, meta, item.time)
    if (live && runtime.config.autoOpen) open(meta, meta.version)
  }, [item.callId])  // eslint-disable-line react-hooks/exhaustive-deps
  const typeKey = `type.${meta.type}` as ArtifactsKey
  return (
    <button type="button" className="dsha-card" data-state="ok" data-artifact-tail onClick={() => open(meta, meta.version)} title={t('card.open')}>
      <span className="dsha-glyph"><TypeGlyph type={meta.type} /></span>
      <span className="dsha-card-body">
        <span className="dsha-card-title">{meta.title}</span>
        <span className="dsha-card-sub">{`${t(typeKey)} · ${t('card.version', { version: meta.version })}`}</span>
      </span>
      <span className="dsha-card-action">{t('card.open')}</span>
    </button>
  )
}

/** Build the `conversation.chat.turnTail` list entry. */
export function createArtifactsTail(runtime: ArtifactRuntime, open: OpenArtifact) {
  return function ArtifactsTail({ turn, t }: TailProps): ReactNode {
    const data = turn.data.get('dshArtifacts') as ArtifactsTurnData | undefined
    if (data === undefined || data.artifacts.length === 0) return null
    return (
      <div className="dsha-tail">
        {data.artifacts.map(item => <TailCard key={`${item.meta.sessionId}/${item.meta.id}`} item={item} runtime={runtime} open={open} t={t} />)}
      </div>
    )
  }
}
