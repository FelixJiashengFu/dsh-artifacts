/**
 * dsh-artifacts, browser half.
 *
 * Registers, through public seats only:
 * - the `artifact` resource tab type (claims `dsh-resource://artifact/…`) and its body and chip title;
 * - the `artifacts` page type (a gallery, offered on the sidebar guide);
 * - the keyed `tool.call.toolview` row for the `artifact` tool.
 * Every import from another DSH client plugin is type-only; services are
 * reached through `ctx`.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { ARTIFACT_KIND, GALLERY_KIND, PACKAGE_ID, TOOL_NAME, artifactAddress } from '../shared/types.ts'
import type { ArtifactMeta } from '../shared/types.ts'
import { ArtifactRuntime } from './runtime.ts'
import { createArtifactCard } from './ArtifactCard.tsx'
import { createArtifactTab } from './ArtifactTab.tsx'
import { createArtifactTitle, createGallery } from './Gallery.tsx'
import { ArtifactGlyph } from './icons.tsx'
import { CSS, STYLE_ID } from './styles.ts'
import { artifactsDefinition, createArtifactsTail } from './turn-artifacts.tsx'
import { en, NS, zh, type ArtifactsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Copy for the artifact card, tab, and gallery. */
    dshArtifacts: ArtifactsKey
  }
}

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightResourceParamsMap {
    /** Which version an artifact tab should show; absent means the latest. */
    artifact: { readonly version?: number }
  }
}

/** Implementation ids (also the keyed slot keys). */
export const ARTIFACT_TAB_ID = `${PACKAGE_ID}/artifact`
export const GALLERY_TAB_ID = `${PACKAGE_ID}/gallery`

export const inject = ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs']

interface ClientServices {
  slots: {
    inject(name: string, callback: () => () => void): () => void
    register(options: Record<string, unknown>, component: unknown): () => void
  }
  locale: {
    register(ns: string, dicts: Record<string, Record<string, string>>): () => void
    bind(ns: string): (key: string, params?: Record<string, unknown>) => string
  }
  sidebarRight: { openResource(address: string, options?: Record<string, unknown>): void }
  sidebarRightTabs: { register(definition: Record<string, unknown>): () => void }
}

export function apply(ctx: Context): void {
  const services = ctx as unknown as Context & ClientServices
  const runtime = new ArtifactRuntime(ctx)
  const t = services.locale.bind(NS) as (key: ArtifactsKey, params?: Record<string, unknown>) => string

  ctx.effect(() => {
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.dataset.plugin = PACKAGE_ID
    style.textContent = CSS
    document.head.appendChild(style)
    return () => style.remove()
  }, 'dsh-artifacts: styles')
  ctx.effect(() => runtime.watchTheme(), 'dsh-artifacts: theme')
  ctx.effect(() => services.locale.register(NS, { en, zh }), 'dsh-artifacts: copy')

  ctx.effect(() => services.sidebarRightTabs.register({
    id: ARTIFACT_TAB_ID,
    kind: ARTIFACT_KIND,
    patterns: ['dsh-resource://artifact/[\\s\\S]+'],
    priority: 'extension',
    title: (address: string) => runtime.meta(address)?.title ?? t('tab.title'),
  }), 'dsh-artifacts: artifact tab type')

  ctx.effect(() => services.sidebarRightTabs.register({
    id: GALLERY_TAB_ID,
    kind: GALLERY_KIND,
    priority: 'extension',
    title: () => t('gallery.title'),
    guide: [{
      id: 'gallery',
      order: 45,
      title: () => t('gallery.title'),
      description: () => t('gallery.description'),
      icon: ArtifactGlyph,
    }],
  }), 'dsh-artifacts: gallery page type')

  const open = (meta: ArtifactMeta, version: number | undefined): void => {
    try {
      services.sidebarRight.openResource(artifactAddress(meta.sessionId, meta.id), {
        ...(version === undefined ? {} : { params: { version } }),
      })
    } catch (error) {
      // No Session on screen (or the sidebar is not mounted yet): nothing to open into.
      console.warn('[dsh-artifacts] could not open artifact', error)
    }
  }

  ctx.effect(() => services.slots.inject('sidebar.right.pane.tab', () => services.slots.register(
    { name: 'sidebar.right.pane.tab', key: ARTIFACT_TAB_ID, locale: NS },
    createArtifactTab(runtime),
  )), 'dsh-artifacts: artifact tab body')

  ctx.effect(() => services.slots.inject('sidebar.right.pane.tab.title', () => services.slots.register(
    { name: 'sidebar.right.pane.tab.title', key: ARTIFACT_TAB_ID },
    createArtifactTitle(runtime),
  )), 'dsh-artifacts: artifact tab title')

  ctx.effect(() => services.slots.inject('sidebar.right.pane.tab', () => services.slots.register(
    { name: 'sidebar.right.pane.tab', key: GALLERY_TAB_ID, locale: NS },
    createGallery(runtime),
  )), 'dsh-artifacts: gallery body')

  ctx.effect(() => services.slots.inject('tool.call.toolview', () => services.slots.register(
    { name: 'tool.call.toolview', key: TOOL_NAME, locale: NS },
    createArtifactCard(runtime, open),
  )), 'dsh-artifacts: tool card')

  // Finished turns fold tool rows away; list the turn's artifacts after its reply.
  ctx.inject(['uiConversation'], (scope) => {
    const conversation = (scope as unknown as { uiConversation: { events: { register(definition: unknown): unknown } } }).uiConversation
    conversation.events.register(artifactsDefinition)
    scope.effect(() => services.slots.inject('conversation.chat.turnTail', () => services.slots.register(
      { name: 'conversation.chat.turnTail', id: `${PACKAGE_ID}/turn-tail`, locale: NS },
      createArtifactsTail(runtime, open),
    )), 'dsh-artifacts: turn tail')
  })
}
