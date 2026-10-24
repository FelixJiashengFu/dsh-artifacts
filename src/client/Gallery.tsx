/** The "Artifacts" sidebar page (guide entry) and the artifact tab's chip title. */
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { ArtifactSummary } from '../shared/types.ts'
import { artifactAddress } from '../shared/types.ts'
import type { ArtifactRuntime } from './runtime.ts'
import type { ArtifactsKey } from './locales.ts'
import type { TabInfoLike } from './ArtifactTab.tsx'
import { Spinner, TypeGlyph } from './icons.tsx'

type Translate = (key: ArtifactsKey, params?: Record<string, unknown>) => string

interface GalleryProps {
  readonly sessionId: string
  readonly useTabInfo: () => TabInfoLike
  readonly t: Translate
}

function relativeTime(time: number): string {
  if (!time) return ''
  try {
    const diff = (time - Date.now()) / 1000
    const fmt = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
    const abs = Math.abs(diff)
    if (abs < 60) return fmt.format(Math.round(diff), 'second')
    if (abs < 3600) return fmt.format(Math.round(diff / 60), 'minute')
    if (abs < 86400) return fmt.format(Math.round(diff / 3600), 'hour')
    return fmt.format(Math.round(diff / 86400), 'day')
  } catch {
    return new Date(time).toLocaleString()
  }
}

export function createGallery(runtime: ArtifactRuntime) {
  return function Gallery({ sessionId, useTabInfo, t }: GalleryProps): ReactNode {
    const { tab } = useTabInfo()
    const versionEvent = useSyncExternalStore(runtime.subscribeVersions, runtime.latestVersionEvent)
    const [items, setItems] = useState<readonly ArtifactSummary[] | undefined>()
    const [failed, setFailed] = useState(false)
    const [reload, setReload] = useState(0)
    useEffect(() => tab.actions.bindCommands({ refresh: () => setReload(n => n + 1) }), [tab.actions])
    useEffect(() => {
      const controller = new AbortController()
      runtime.list(sessionId, controller.signal).then(
        (result) => {
          const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : []
          setFailed(false)
          setItems(artifacts)
          for (const item of artifacts) {
            runtime.rememberMeta(artifactAddress(sessionId, item.id), { title: item.title, type: item.type, latest: item.versions })
          }
        },
        () => { if (!controller.signal.aborted) setFailed(true) },
      )
      return () => controller.abort()
    }, [sessionId, versionEvent?.seq, reload])

    return (
      <div className="dsha-gallery">
        <h2>{t('gallery.title')}</h2>
        {items === undefined && !failed ? <div className="dsha-gallery-empty"><Spinner /> {t('gallery.loading')}</div> : null}
        {failed ? <div className="dsha-gallery-empty" role="alert">{t('gallery.failed')}</div> : null}
        {items !== undefined && items.length === 0 ? <div className="dsha-gallery-empty">{t('gallery.empty')}</div> : null}
        {items?.map(item => (
          <button key={item.id} type="button" className="dsha-card" data-state="ok"
            onClick={() => tab.actions.openResource(artifactAddress(sessionId, item.id), { preferNewPane: false })}>
            <span className="dsha-glyph"><TypeGlyph type={item.type} /></span>
            <span className="dsha-card-body">
              <span className="dsha-card-title">{item.title}</span>
              <span className="dsha-card-sub">
                {[t(`type.${item.type}` as ArtifactsKey), item.versions === 1 ? t('gallery.oneVersion') : t('gallery.versions', { count: item.versions }), relativeTime(item.updatedAt)]
                  .filter(Boolean).join(' · ')}
              </span>
            </span>
          </button>
        ))}
      </div>
    )
  }
}

export function createArtifactTitle(runtime: ArtifactRuntime) {
  return function ArtifactTitle({ useTabInfo }: { useTabInfo: () => TabInfoLike }): ReactNode {
    const { tab } = useTabInfo()
    const address = tab.contentId ?? tab.navigation.address
    const meta = useSyncExternalStore(runtime.subscribeMeta, () => runtime.meta(address))
    return (
      <>
        <TypeGlyph type={meta?.type ?? ''} size={14} className="dsha-title-glyph" />
        {meta?.title ?? tab.title}
      </>
    )
  }
}
