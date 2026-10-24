/**
 * The artifact tab body: toolbar (title, versions, preview/code, copy,
 * download, open in browser, reload), the sandboxed live preview, and an
 * error bar that can hand runtime errors back to the agent.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  IconChevronLeftOutlineRegular, IconChevronRightOutlineRegular, IconCopyOutlineRegular,
  IconDownloadOutlineRegular, IconRefreshOutlineRegular, IconRightUpOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ArtifactReadResult } from '../shared/types.ts'
import { parseArtifactAddress, sourceExtension } from '../shared/types.ts'
import { buildDocument } from '../shared/document.ts'
import type { ArtifactRuntime } from './runtime.ts'
import { copyText, downloadText } from './runtime.ts'
import { errorReport, handleCall, type RuntimeErrorReport } from './bridge.ts'
import type { ArtifactsKey } from './locales.ts'
import { Spinner, TypeGlyph } from './icons.tsx'

type Translate = (key: ArtifactsKey, params?: Record<string, unknown>) => string

/** The slice of the sidebar's tab information this body reads. */
export interface TabInfoLike {
  readonly tab: {
    readonly id: string
    readonly title: string
    readonly contentId?: string
    readonly visible: boolean
    readonly navigation: { readonly address: string; readonly params?: unknown; readonly revision: number }
    readonly actions: {
      bindCommands(commands: { refresh?: () => void }): () => void
      openResource(address: string, options?: Record<string, unknown>): void
    }
  }
}

export interface ArtifactTabProps {
  readonly sessionId: string
  readonly useTabInfo: () => TabInfoLike
  readonly t: Translate
}

type LoadState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly data: ArtifactReadResult }

const SANDBOX = 'allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-downloads'
const MIME: Readonly<Record<string, string>> = {
  html: 'text/html', jsx: 'text/javascript', svg: 'image/svg+xml', mmd: 'text/plain', md: 'text/markdown',
}

function requestedVersion(params: unknown): number | undefined {
  const v = (params as { version?: unknown } | undefined)?.version
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : undefined
}

function CodeView({ source }: { source: string }): ReactNode {
  const lines = useMemo(() => source.split('\n'), [source])
  return (
    <pre className="dsha-code"><table><tbody>
      {lines.map((line, i) => (
        <tr key={i}><td className="dsha-ln">{i + 1}</td><td>{line === '' ? ' ' : line}</td></tr>
      ))}
    </tbody></table></pre>
  )
}

function useToast(): [string | undefined, (text: string) => void] {
  const [toast, setToast] = useState<string>()
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const show = useCallback((text: string) => {
    setToast(text)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(undefined), 2200)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])
  return [toast, show]
}

export function createArtifactTab(runtime: ArtifactRuntime) {
  return function ArtifactTab({ sessionId, useTabInfo, t }: ArtifactTabProps): ReactNode {
    const { tab } = useTabInfo()
    const address = tab.navigation.address
    const target = useMemo(() => parseArtifactAddress(address), [address])
    const navRevision = tab.navigation.revision
    const [version, setVersion] = useState<number | undefined>(() => requestedVersion(tab.navigation.params))
    const [reloadKey, setReloadKey] = useState(0)
    const [frameNonce, setFrameNonce] = useState(0)
    const [view, setView] = useState<'preview' | 'code'>('preview')
    const [state, setState] = useState<LoadState>({ status: 'loading' })
    const [errors, setErrors] = useState<readonly RuntimeErrorReport[]>([])
    const [menuOpen, setMenuOpen] = useState(false)
    const [toast, showToast] = useToast()
    const frameRef = useRef<HTMLIFrameElement>(null)
    const menuRef = useRef<HTMLDivElement>(null)
    const theme = useSyncExternalStore(runtime.subscribeTheme, runtime.themeMode)
    const versionEvent = useSyncExternalStore(runtime.subscribeVersions, runtime.latestVersionEvent)

    // A navigation (card click, reopen) selects the version it names, or the latest.
    const firstNav = useRef(true)
    useEffect(() => {
      if (firstNav.current) { firstNav.current = false; return }
      setVersion(requestedVersion(tab.navigation.params))
    }, [navRevision])  // eslint-disable-line react-hooks/exhaustive-deps

    // New versions written by the agent replace the preview, as in Claude.
    const seenEvent = useRef(versionEvent?.seq)
    useEffect(() => {
      if (versionEvent === undefined || versionEvent.seq === seenEvent.current) return
      seenEvent.current = versionEvent.seq
      if (versionEvent.address === address) setVersion(versionEvent.version)
    }, [versionEvent, address])

    useEffect(() => tab.actions.bindCommands({ refresh: () => setReloadKey(k => k + 1) }), [tab.actions])

    useEffect(() => {
      if (target === undefined) {
        setState({ status: 'error', message: 'Malformed artifact address.' })
        return
      }
      const controller = new AbortController()
      setState(prev => prev.status === 'ready' ? prev : { status: 'loading' })
      runtime.read(target.sessionId, target.id, version, controller.signal).then(
        data => { if (!controller.signal.aborted) setState({ status: 'ready', data }) },
        (error: unknown) => {
          if (!controller.signal.aborted) setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
        },
      )
      return () => controller.abort()
    }, [target, version, reloadKey])

    const data = state.status === 'ready' ? state.data : undefined
    const record = data?.record
    const documentHtml = useMemo(
      () => record === undefined ? undefined : buildDocument(record, { cdn: runtime.config.cdn, theme }),
      [record, theme],
    )
    useEffect(() => { setErrors([]) }, [documentHtml, frameNonce])
    useEffect(() => { if (record?.type === 'code') setView('preview') }, [record?.type])

    // Bridge: answer storage and AI calls from this tab's iframe only.
    useEffect(() => {
      if (target === undefined) return
      const onMessage = (event: MessageEvent): void => {
        const frame = frameRef.current
        if (frame === null || event.source !== frame.contentWindow) return
        const message = event.data as { __dshArtifact?: number; kind?: string; id?: number; op?: unknown; payload?: unknown; error?: unknown } | null
        if (message === null || typeof message !== 'object' || message.__dshArtifact !== 1) return
        if (message.kind === 'error') {
          const report = errorReport(message.error)
          if (report) setErrors(prev => prev.length >= 20 || prev.some(p => p.message === report.message) ? prev : [...prev, report])
          return
        }
        if (message.kind !== 'call' || typeof message.id !== 'number') return
        const source = event.source as Window
        const reply = (ok: boolean, value?: unknown, error?: string): void => {
          try {
            source.postMessage({ __dshArtifact: 1, kind: 'reply', id: message.id, ok, value, error }, '*')
          } catch {
            // The frame navigated away or was replaced; the call is moot.
          }
        }
        handleCall(runtime, target, message.op, message.payload).then(
          value => reply(true, value),
          (error: unknown) => reply(false, undefined, error instanceof Error ? error.message : String(error)),
        )
      }
      window.addEventListener('message', onMessage)
      return () => window.removeEventListener('message', onMessage)
    }, [target])

    useEffect(() => {
      if (!menuOpen) return
      const onDown = (event: MouseEvent): void => {
        if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false)
      }
      document.addEventListener('mousedown', onDown)
      return () => document.removeEventListener('mousedown', onDown)
    }, [menuOpen])

    if (state.status === 'loading' || (state.status === 'error' && data === undefined)) {
      return (
        <div className="dsha-tab">
          {state.status === 'loading'
            ? <div className="dsha-status" role="status"><Spinner /> {t('tab.loading')}</div>
            : <div className="dsha-status" role="alert">{t('tab.missing')} {state.message}</div>}
        </div>
      )
    }
    if (data === undefined || record === undefined || target === undefined) return null

    const versions = data.versions
    const index = versions.findIndex(v => v.version === data.version)
    const previous = index > 0 ? versions[index - 1] : undefined
    const next = index >= 0 && index < versions.length - 1 ? versions[index + 1] : undefined
    const latest = versions[versions.length - 1]
    const ext = sourceExtension(record)
    const showToggle = record.type !== 'code'

    const copySource = async (): Promise<void> => {
      if (await copyText(record.content)) showToast(t('tab.copied'))
    }
    const downloadSource = (): void => {
      setMenuOpen(false)
      downloadText(ext === 'Dockerfile' ? 'Dockerfile' : `${target.id}.${ext}`, record.content, MIME[ext] ?? 'text/plain')
    }
    const downloadHtml = (): void => {
      setMenuOpen(false)
      downloadText(`${target.id}.html`, buildDocument(record, { cdn: runtime.config.cdn, theme: 'light' }), 'text/html')
    }
    const openInBrowser = (): void => {
      window.open(runtime.viewUrl(target.sessionId, target.id, data.version, theme), '_blank', 'noopener')
    }
    const askToFix = async (): Promise<void> => {
      const first = errors[0]
      if (first === undefined) return
      const detail = first.message.slice(0, 3000)
      const text = t('tab.fixPrompt', { title: record.title, id: target.id, version: data.version, error: detail })
      let sent = false
      try {
        sent = await runtime.sendToSession(sessionId, text)
      } catch {
        sent = false
      }
      if (sent) showToast(t('tab.fixSent'))
      else if (await copyText(text)) showToast(t('tab.fixCopied'))
      setErrors([])
    }
    const copyError = async (): Promise<void> => {
      const first = errors[0]
      if (first && await copyText(`${first.message}${first.stack ? `\n${first.stack}` : ''}`)) showToast(t('tab.copied'))
    }

    const themed = record.type === 'markdown' || record.type === 'code' || record.type === 'mermaid'
    return (
      <div className="dsha-tab" data-artifact-type={record.type}>
        <div className="dsha-bar">
          <div className="dsha-bar-title">
            <TypeGlyph type={record.type} size={16} />
            <b title={record.title}>{record.title}</b>
          </div>
          {versions.length > 1 ? (
            <div className="dsha-versions">
              <button type="button" className="dsha-tool" disabled={previous === undefined} title={t('tab.previous')} aria-label={t('tab.previous')}
                onClick={() => previous && setVersion(previous.version)}>
                <IconChevronLeftOutlineRegular size={14} />
              </button>
              <span>{t('tab.versionOf', { version: index + 1, total: versions.length })}</span>
              <button type="button" className="dsha-tool" disabled={next === undefined} title={t('tab.next')} aria-label={t('tab.next')}
                onClick={() => next && setVersion(next.version)}>
                <IconChevronRightOutlineRegular size={14} />
              </button>
              {latest !== undefined && latest.version !== data.version
                ? <button type="button" className="dsha-tool" onClick={() => setVersion(undefined)}>{t('tab.latest')}</button>
                : null}
            </div>
          ) : null}
          {showToggle ? (
            <div className="dsha-seg" role="group" aria-label={t('tab.viewMode')}>
              <button type="button" aria-pressed={view === 'preview'} onClick={() => setView('preview')}>{t('tab.preview')}</button>
              <button type="button" aria-pressed={view === 'code'} onClick={() => setView('code')}>{t('tab.code')}</button>
            </div>
          ) : null}
          <button type="button" className="dsha-tool" title={t('tab.copy')} aria-label={t('tab.copy')} onClick={() => { void copySource() }}>
            <IconCopyOutlineRegular size={15} />
          </button>
          <div className="dsha-menu-wrap" ref={menuRef}>
            <button type="button" className="dsha-tool" title={t('tab.download')} aria-label={t('tab.download')} aria-expanded={menuOpen}
              onClick={() => setMenuOpen(open => !open)}>
              <IconDownloadOutlineRegular size={15} />
            </button>
            {menuOpen ? (
              <div className="dsha-menu" role="menu">
                <button type="button" role="menuitem" onClick={downloadSource}>{t('tab.downloadSource', { ext })}</button>
                {record.type !== 'html' ? <button type="button" role="menuitem" onClick={downloadHtml}>{t('tab.downloadHtml')}</button> : null}
              </div>
            ) : null}
          </div>
          {!runtime.desktop ? (
            <button type="button" className="dsha-tool" title={t('tab.openNew')} aria-label={t('tab.openNew')} onClick={openInBrowser}>
              <IconRightUpOutlineRegular size={15} />
            </button>
          ) : null}
          <button type="button" className="dsha-tool" title={t('tab.reload')} aria-label={t('tab.reload')} onClick={() => setFrameNonce(n => n + 1)}>
            <IconRefreshOutlineRegular size={15} />
          </button>
        </div>
        <div className="dsha-stage">
          {view === 'code' && showToggle
            ? <CodeView source={record.content} />
            : (
                <iframe
                  key={`${data.version}:${theme}:${frameNonce}`}
                  ref={frameRef}
                  className="dsha-frame"
                  data-themed={themed ? theme : undefined}
                  title={t('tab.frame')}
                  sandbox={SANDBOX}
                  allow="clipboard-write; fullscreen"
                  srcDoc={documentHtml}
                  data-artifact-preview
                />
              )}
          {toast !== undefined ? <div className="dsha-toast" role="status">{toast}</div> : null}
        </div>
        {errors.length > 0 && view === 'preview' ? (
          <div className="dsha-error" role="alert">
            <div className="dsha-error-text">
              <strong>{t('tab.error')}{errors.length > 1 ? ` (${t('tab.errorMore', { count: errors.length - 1 })})` : ''}</strong>
              {errors[0]!.message}
            </div>
            <div className="dsha-error-actions">
              <button type="button" className="dsha-primary" onClick={() => { void askToFix() }}>{t('tab.fix')}</button>
              <button type="button" onClick={() => { void copyError() }}>{t('tab.copyError')}</button>
              <button type="button" onClick={() => setErrors([])} aria-label={t('tab.dismiss')}>×</button>
            </div>
          </div>
        ) : null}
      </div>
    )
  }
}
