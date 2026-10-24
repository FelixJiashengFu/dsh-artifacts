import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { transform } from 'esbuild'
import { ArtifactStore, type LogEvent } from '../src/host/store.ts'
import { applyCommand, createArtifactTool, toolDescription } from '../src/host/tool.ts'
import { registerRoutes, VIEW_CSP } from '../src/host/routes.ts'
import { promptText } from '../src/host/ai.ts'
import { buildDocument, scriptString } from '../src/shared/document.ts'
import { artifactAddress, DEFAULT_CDN, normalizeType, parseArtifactAddress, ROUTES, type ArtifactMeta, type ArtifactRecord } from '../src/shared/types.ts'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'dsha-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

/** A fake agent whose session log the tool can read. */
function fakeExec(sessionId: string, callId: string, events: LogEvent[] = []) {
  return { callId, agent: { id: sessionId, session: { snapshotEvents: () => events } } }
}

describe('shared types', () => {
  it('normalizes Claude MIME type names', () => {
    expect(normalizeType('application/vnd.ant.react')).toBe('react')
    expect(normalizeType('text/html')).toBe('html')
    expect(normalizeType('image/svg+xml')).toBe('svg')
    expect(normalizeType('application/vnd.ant.mermaid')).toBe('mermaid')
    expect(normalizeType('text/markdown')).toBe('markdown')
    expect(normalizeType('application/vnd.ant.code')).toBe('code')
    expect(normalizeType('pdf')).toBeUndefined()
  })
  it('round-trips resource addresses', () => {
    const address = artifactAddress('sess/1 x', 'my-app')
    expect(parseArtifactAddress(address)).toEqual({ sessionId: 'sess/1 x', id: 'my-app' })
    expect(parseArtifactAddress('dsh-resource://file/x')).toBeUndefined()
  })
})

describe('applyCommand', () => {
  const base: ArtifactRecord = { type: 'html', title: 'T', content: '<p>a</p>\n<p>b</p>' }
  it('creates, rewrites and updates', () => {
    expect(applyCommand('create', undefined, { id: 'x', type: 'text/html', title: 'Page', content: '<p>hi</p>' }).record)
      .toEqual({ type: 'html', title: 'Page', content: '<p>hi</p>' })
    expect(applyCommand('update', base, { id: 'x', old_str: '<p>b</p>', new_str: '<p>c</p>' }).record.content).toBe('<p>a</p>\n<p>c</p>')
    expect(applyCommand('rewrite', base, { id: 'x', content: 'new', title: 'New' }).record).toMatchObject({ title: 'New', content: 'new', type: 'html' })
  })
  it('rejects ambiguous or missing old_str with model-readable errors', () => {
    expect(() => applyCommand('update', { ...base, content: 'aa' }, { id: 'x', old_str: 'a', new_str: 'b' })).toThrow(/matches 2 places/)
    expect(() => applyCommand('update', base, { id: 'x', old_str: 'zzz', new_str: 'b' })).toThrow(/not found/)
    expect(() => applyCommand('update', undefined, { id: 'x', old_str: 'a', new_str: 'b' })).toThrow(/Use create/)
    expect(() => applyCommand('create', undefined, { id: 'x', type: 'pdf', title: 't', content: 'c' })).toThrow(/Unknown artifact type/)
    expect(() => applyCommand('create', undefined, { id: 'x', type: 'html', content: 'c' })).toThrow(/title/)
  })
  it('keeps language only for code', () => {
    expect(applyCommand('create', undefined, { id: 'x', type: 'code', title: 't', language: 'python', content: 'print(1)' }).record.language).toBe('python')
    expect(applyCommand('create', undefined, { id: 'x', type: 'html', title: 't', language: 'python', content: 'x' }).record.language).toBeUndefined()
  })
})

describe('artifact tool', () => {
  it('versions an artifact across create, update and rewrite', async () => {
    const store = new ArtifactStore(dir)
    const tool = createArtifactTool(store, { maxBytes: 100_000, ai: true }) as unknown as {
      name: string
      execute(args: unknown, exec: unknown): Promise<ArtifactMeta & { note?: string }>
      output: { render(args: unknown, value: unknown): { type: string; text: string }[]; presentationMeta(args: unknown, value: unknown): unknown }
    }
    expect(tool.name).toBe('artifact')
    const v1 = await tool.execute({ command: 'create', id: 'counter', type: 'react', title: 'Counter', content: 'export default () => <b>0</b>' }, fakeExec('s1', 'c1'))
    expect(v1).toMatchObject({ sessionId: 's1', id: 'counter', version: 1, type: 'react', title: 'Counter', lines: 1 })
    const v2 = await tool.execute({ command: 'update', id: 'counter', old_str: '<b>0</b>', new_str: '<b>1</b>' }, fakeExec('s1', 'c2'))
    expect(v2.version).toBe(2)
    const v3 = await tool.execute({ command: 'rewrite', id: 'counter', title: 'Counter 2', content: 'export default () => null' }, fakeExec('s1', 'c3'))
    expect(v3).toMatchObject({ version: 3, title: 'Counter 2' })
    expect(tool.output.render({}, v1)[0]!.text).toMatch(/created: version 1/)
    expect(tool.output.presentationMeta({}, { ...v3, note: 'x' })).not.toHaveProperty('note')
    const history = await store.history('s1', 'counter')
    expect(history.map(h => h.version)).toEqual([1, 2, 3])
    expect((await store.getBlob(history[1]!.sha))!.content).toBe('export default () => <b>1</b>')
    expect(await store.list('s1')).toMatchObject([{ id: 'counter', title: 'Counter 2', versions: 3 }])
    await expect(tool.execute({ command: 'create', id: 'bad id!', type: 'html', title: 't', content: 'x' }, fakeExec('s1', 'c4'))).rejects.toThrow(/id must be/)
    await expect(tool.execute({ command: 'create', id: 'big', type: 'html', title: 't', content: 'x'.repeat(100_001) }, fakeExec('s1', 'c5'))).rejects.toThrow(/limit/)
  })

  it('continues a forked session from the artifact metas in its log', async () => {
    const store = new ArtifactStore(dir)
    const tool = createArtifactTool(store, { maxBytes: 100_000, ai: false }) as unknown as {
      execute(args: unknown, exec: unknown): Promise<ArtifactMeta>
    }
    const v1 = await tool.execute({ command: 'create', id: 'doc', type: 'markdown', title: 'Doc', content: '# One' }, fakeExec('parent', 'p1'))
    const forkLog: LogEvent[] = [
      { type: 'tool/call', data: { callId: 'p1', name: 'artifact' } },
      { type: 'tool/result', time: 1, data: { message: { toolCallId: 'p1', isError: false }, meta: v1 } },
    ]
    // A fresh store instance (as after a restart) with no index for the fork.
    const fresh = new ArtifactStore(dir)
    const forkTool = createArtifactTool(fresh, { maxBytes: 100_000, ai: false }) as unknown as {
      execute(args: unknown, exec: unknown): Promise<ArtifactMeta>
    }
    const v2 = await forkTool.execute({ command: 'update', id: 'doc', old_str: '# One', new_str: '# Two' }, fakeExec('fork', 'f1', forkLog))
    expect(v2).toMatchObject({ sessionId: 'fork', version: 2 })
    expect((await fresh.history('fork', 'doc')).map(h => h.version)).toEqual([1, 2])
    expect((await fresh.history('parent', 'doc')).map(h => h.version)).toEqual([1])
  })

  it('stores identical content once', async () => {
    const store = new ArtifactStore(dir)
    const record: ArtifactRecord = { type: 'svg', title: 'x', content: '<svg/>' }
    const a = await store.putBlob(record)
    const b = await new ArtifactStore(dir).putBlob({ ...record })
    expect(a).toBe(b)
    const shards = await readdir(join(dir, 'blobs'))
    expect(shards).toHaveLength(1)
  })

  it('describes window.claude.complete only when AI is enabled', () => {
    expect(toolDescription({ ai: true })).toMatch(/window\.claude\.complete/)
    expect(toolDescription({ ai: false })).not.toMatch(/window\.claude\.complete/)
  })
})

describe('routes', () => {
  async function setup(aiEnabled = false) {
    const store = new ArtifactStore(dir)
    const routes = new Map<string, (request: Request) => Promise<Response>>()
    const ctx = {
      connection: { fetch: { register: (route: { path: string; fetch: (r: Request) => Promise<Response> }) => { routes.set(route.path, route.fetch); return async () => {} } } },
      effect: (fn: () => unknown) => { fn() },
    }
    const ai = { enabled: aiEnabled, complete: async () => 'pong' }
    registerRoutes(ctx as never, store, ai as never, {
      cdn: DEFAULT_CDN,
      storage: { maxKeyLength: 20, maxValueBytes: 64, maxTotalBytes: 400 },
    })
    const tool = createArtifactTool(store, { maxBytes: 100_000, ai: aiEnabled }) as unknown as { execute(a: unknown, e: unknown): Promise<ArtifactMeta> }
    await tool.execute({ command: 'create', id: 'page', type: 'html', title: 'Page', content: '<h1>Hi</h1>' }, fakeExec('s', 'c1'))
    await tool.execute({ command: 'update', id: 'page', old_str: 'Hi', new_str: 'Hello' }, fakeExec('s', 'c2'))
    const get = (path: string, query: string) => routes.get(path)!(new Request(`http://h${path}?${query}`))
    const post = (path: string, body: unknown) => routes.get(path)!(new Request(`http://h${path}`, { method: 'POST', body: JSON.stringify(body) }))
    return { get, post }
  }

  it('lists and reads versions', async () => {
    const { get } = await setup()
    const list = await (await get(ROUTES.list, 'sessionId=s')).json()
    expect(list.artifacts).toMatchObject([{ id: 'page', versions: 2 }])
    const latest = await (await get(ROUTES.read, 'sessionId=s&id=page')).json()
    expect(latest).toMatchObject({ version: 2, record: { content: '<h1>Hello</h1>' } })
    expect(latest.versions).toHaveLength(2)
    const first = await (await get(ROUTES.read, 'sessionId=s&id=page&version=1')).json()
    expect(first.record.content).toBe('<h1>Hi</h1>')
    expect((await get(ROUTES.read, 'sessionId=s&id=nope')).status).toBe(404)
    expect((await get(ROUTES.read, 'sessionId=s')).status).toBe(400)
  })

  it('serves the standalone page in an opaque-origin sandbox', async () => {
    const { get } = await setup()
    const response = await get(ROUTES.view, 'sessionId=s&id=page')
    expect(response.headers.get('content-security-policy')).toBe(VIEW_CSP)
    expect(VIEW_CSP).not.toMatch(/allow-same-origin/)
    const html = await response.text()
    expect(html).toContain('<h1>Hello</h1>')
    expect(html).toContain('window.claude')
  })

  it('implements Claude-compatible window.storage semantics with limits', async () => {
    const { post } = await setup()
    const call = async (body: Record<string, unknown>) => {
      const response = await post(ROUTES.storage, { sessionId: 's', id: 'page', ...body })
      return { status: response.status, body: await response.json() }
    }
    expect((await call({ op: 'get', key: 'k' })).body).toBeNull()
    expect((await call({ op: 'set', key: 'k', value: 'v' })).body).toEqual({ key: 'k', value: 'v', shared: false })
    expect((await call({ op: 'set', key: 'k', value: 'w', shared: true })).body).toEqual({ key: 'k', value: 'w', shared: true })
    expect((await call({ op: 'get', key: 'k' })).body).toEqual({ key: 'k', value: 'v', shared: false })
    expect((await call({ op: 'list', prefix: 'k' })).body).toEqual({ keys: ['k'], prefix: 'k', shared: false })
    expect((await call({ op: 'delete', key: 'k' })).body).toEqual({ key: 'k', deleted: true, shared: false })
    expect((await call({ op: 'set', key: 'k', value: 'x'.repeat(65) })).status).toBe(413)
    expect((await call({ op: 'set', key: 'x'.repeat(21), value: 'v' })).status).toBe(400)
    expect((await call({ op: 'set', key: 'k', value: 1 })).status).toBe(400)
    for (let i = 0; i < 6; i++) await call({ op: 'set', key: `k${i}`, value: 'y'.repeat(60) })
    expect((await call({ op: 'set', key: 'k9', value: 'y'.repeat(60) })).status).toBe(413)
  })

  it('refuses AI calls when disabled and answers when enabled', async () => {
    expect((await (await setup(false)).post(ROUTES.complete, { sessionId: 's', id: 'page', prompt: 'ping' })).status).toBe(403)
    await rm(dir, { recursive: true, force: true })
    const enabled = await setup(true)
    const response = await enabled.post(ROUTES.complete, { sessionId: 's', id: 'page', prompt: 'ping' })
    expect(await response.json()).toEqual({ text: 'pong' })
  })
})

describe('documents', () => {
  const types: ArtifactRecord[] = [
    { type: 'html', title: 'h', content: '<!doctype html><html><head><title>x</title></head><body>hi</body></html>' },
    { type: 'react', title: 'r', content: 'import { useState } from "react";\nexport default function App(){ return <div>`$${"</script>"}</div> }' },
    { type: 'svg', title: 's', content: '<svg viewBox="0 0 10 10"><circle r="4" cx="5" cy="5"/></svg>' },
    { type: 'mermaid', title: 'm', content: 'graph TD\n A-->B' },
    { type: 'markdown', title: 'md', content: '# T\n\nInline $e^{i\\pi}+1=0$ and\n\n$$\\int_0^1 x\\,dx$$\n\n```js\nconst a = `x`\n```' },
    { type: 'code', title: 'c', language: 'python', content: 'print("</script>")\nx = 1' },
  ]
  for (const record of types) {
    it(`builds a valid ${record.type} document`, async () => {
      const html = buildDocument(record, { cdn: DEFAULT_CDN, theme: 'dark' })
      expect(html.indexOf('window.claude')).toBeGreaterThan(-1)
      // The bridge must run before any artifact code.
      expect(html.indexOf('__dshArtifact')).toBeLessThan(html.indexOf('</head>') === -1 ? Infinity : html.indexOf('</head>'))
      // Every inline script must parse as JavaScript (catches template escaping bugs).
      const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)]
      expect(scripts.length).toBeGreaterThan(0)
      for (const [, attrs, code] of scripts) {
        if (/importmap/.test(attrs!)) {
          expect(() => JSON.parse(code!)).not.toThrow()
          continue
        }
        await expect(transform(code!, { loader: 'js', format: 'esm', target: 'es2022' })).resolves.toBeTruthy()
      }
      // User content never terminates a script element early.
      for (const [, , code] of scripts) expect(code).not.toMatch(/<\/script/i)
    })
  }
  it('injects the bridge into an existing <head>', () => {
    const html = buildDocument({ type: 'html', title: 'h', content: '<html><head lang="x"><meta name=a></head><body></body></html>' }, { cdn: DEFAULT_CDN, theme: 'light' })
    expect(html.startsWith('<html><head lang="x"><script>')).toBe(true)
  })
  it('escapes script-breaking sequences', () => {
    expect(scriptString('</script><!--\u2028')).not.toMatch(/<|\u2028/)
    expect(JSON.parse(scriptString('a</script>b'))).toBe('a</script>b')
  })
})

describe('promptText', () => {
  it('accepts strings and message arrays', () => {
    expect(promptText('hi')).toBe('hi')
    expect(promptText([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: [{ type: 'text', text: 'c' }] }]))
      .toBe('User: a\n\nAssistant: b\n\nUser: c\n\nAssistant:')
    expect(() => promptText(3)).toThrow()
  })
})
