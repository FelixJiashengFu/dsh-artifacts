/**
 * The `artifact` tool's row in the conversation: a live "writing" card while
 * the model streams the call, then a clickable card that opens the artifact
 * in the right sidebar (and opens it automatically when the result is live).
 */
import { useEffect, type ReactNode } from 'react'
import type { ArtifactMeta } from '../shared/types.ts'
import { isArtifactMeta } from '../shared/types.ts'
import type { ArtifactRuntime } from './runtime.ts'
import type { ArtifactsKey } from './locales.ts'
import { Spinner, TypeGlyph } from './icons.tsx'

type Translate = (key: ArtifactsKey, params?: Record<string, unknown>) => string

/** The slice of a streaming argument reader this card uses. */
interface ArgsReader {
  text(key: string): string | undefined
  textPrefix(key: string, maxLength: number): string | undefined
  stringLength(key: string, options?: { step?: number }): number | undefined
}

interface ResultBlock {
  readonly callId: string
  readonly time: number
  readonly isError: boolean
  readonly content: readonly { type: string; text?: string }[]
  readonly error?: { name: string; code: string; reason?: string } | undefined
  readonly meta?: unknown
  readonly args: ArgsReader
}

interface CardProps {
  readonly phase: 'preparing' | 'start' | 'result'
  readonly block: { readonly callId: string; readonly args: ArgsReader } & Partial<ResultBlock>
  readonly t: Translate
}

export type OpenArtifact = (meta: ArtifactMeta, version: number | undefined) => void

function typeLabel(t: Translate, type: string | undefined): string | undefined {
  switch (type) {
    case 'html': case 'react': case 'svg': case 'mermaid': case 'markdown': case 'code':
      return t(`type.${type}` as ArtifactsKey)
    default:
      return undefined
  }
}

function RunningCard({ args, t }: { args: ArgsReader; t: Translate }): ReactNode {
  const command = args.text('command')
  const title = args.text('title') ?? args.textPrefix('title', 160) ?? args.text('id') ?? args.textPrefix('id', 64)
  const type = args.text('type')
  const length = args.stringLength('content', { step: 100 }) ?? args.stringLength('new_str', { step: 100 })
  const heading = command === 'update' || command === 'rewrite' ? t('card.updating') : t('card.creating')
  const sub = [typeLabel(t, type), length === undefined ? t('card.writing') : t('card.chars', { count: length.toLocaleString() })]
    .filter(Boolean).join(' · ')
  return (
    <div className="dsha-card" data-state="running" data-tool="artifact" aria-busy>
      <span className="dsha-glyph"><Spinner size={18} /></span>
      <span className="dsha-card-body">
        <span className="dsha-card-title">{title || heading}</span>
        <span className="dsha-card-sub">{title ? `${heading} · ${sub}` : sub}</span>
      </span>
    </div>
  )
}

function firstLine(text: string): string {
  const line = text.split('\n').find(l => l.trim() !== '') ?? text
  return line.length > 240 ? `${line.slice(0, 240)}…` : line
}

function ResultCard({ block, t, runtime, open }: { block: ResultBlock; t: Translate; runtime: ArtifactRuntime; open: OpenArtifact }): ReactNode {
  const meta = isArtifactMeta(block.meta) ? block.meta : undefined
  const ok = meta !== undefined && !block.isError
  useEffect(() => {
    if (!ok || meta === undefined) return
    const live = runtime.noteResult(block.callId, meta, block.time)
    if (live && runtime.config.autoOpen) open(meta, meta.version)
    // One announcement per call; later re-renders of the same row are no-ops.
  }, [ok, block.callId])  // eslint-disable-line react-hooks/exhaustive-deps

  if (!ok || meta === undefined) {
    const stopped = block.error?.code === 'interrupted'
    const text = block.content.map(part => part.text ?? '').join('\n').trim() || block.error?.reason || block.error?.code || ''
    const title = block.args.text('title') ?? block.args.text('id') ?? t('tab.title')
    return (
      <div className="dsha-card" data-state="error" data-tool="artifact">
        <span className="dsha-glyph"><TypeGlyph type={block.args.text('type') ?? ''} /></span>
        <span className="dsha-card-body">
          <span className="dsha-card-title">{stopped ? t('card.stopped') : t('card.failed')} · {title}</span>
          {text ? <span className="dsha-card-sub" data-error>{firstLine(text)}</span> : null}
        </span>
      </div>
    )
  }
  const sub = [typeLabel(t, meta.type), t('card.version', { version: meta.version })].filter(Boolean).join(' · ')
  return (
    <button type="button" className="dsha-card" data-state="ok" data-tool="artifact" onClick={() => open(meta, meta.version)}
      title={t('card.open')}>
      <span className="dsha-glyph"><TypeGlyph type={meta.type} /></span>
      <span className="dsha-card-body">
        <span className="dsha-card-title">{meta.title}</span>
        <span className="dsha-card-sub">{sub}</span>
      </span>
      <span className="dsha-card-action">{t('card.open')}</span>
    </button>
  )
}

/**
 * Build the keyed `tool.call.toolview` component.
 * @param runtime - shared browser state.
 * @param open - opens an artifact version in the sidebar.
 */
export function createArtifactCard(runtime: ArtifactRuntime, open: OpenArtifact) {
  return function ArtifactCard(props: CardProps): ReactNode {
    if (props.phase !== 'result') return <RunningCard args={props.block.args} t={props.t} />
    return <ResultCard block={props.block as ResultBlock} t={props.t} runtime={runtime} open={open} />
  }
}
