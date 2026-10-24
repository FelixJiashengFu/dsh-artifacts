import { describe, expect, it } from 'vitest'
import { currentTurn } from '../src/host/records.ts'
import { ArtifactStore } from '../src/host/store.ts'
import { artifactsDefinition } from '../src/client/turn-artifacts.tsx'
import { RECORD_TYPE, type ArtifactMeta } from '../src/shared/types.ts'

const meta = (version: number, id = 'app'): ArtifactMeta => ({
  sessionId: 's', id, version, type: 'react', title: `App v${version}`, command: version === 1 ? 'create' : 'update',
  sha: 'a'.repeat(64), bytes: 10, lines: 1,
})

describe('currentTurn', () => {
  it('finds the latest turn/start by scanning backwards', () => {
    const events = [
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'user/message', data: {} },
      { type: 'turn/start', data: { turn: 2 } },
      { type: 'tool/call', data: {} },
    ]
    expect(currentTurn({ seq: events.length, eventAt: (seq: number) => events[seq] })).toBe(2)
    expect(currentTurn({ snapshotEvents: () => events })).toBe(2)
    expect(currentTurn({ snapshotEvents: () => [] })).toBeUndefined()
  })
})

describe('index rebuild from plugin records', () => {
  it('rebuilds versions from records when tool events are absent (PTC calls)', () => {
    const index = ArtifactStore.indexFromLog([
      { type: RECORD_TYPE, time: 5, data: { ...meta(1), turn: 1, callId: 'x' } },
      { type: RECORD_TYPE, time: 6, data: { ...meta(2), turn: 1, callId: 'y' } },
      { type: RECORD_TYPE, time: 7, data: { ...meta(2), turn: 1, callId: 'y' } },
    ])
    expect(index.artifacts.app!.map(v => [v.version, v.callId])).toEqual([[1, 'x'], [2, 'y']])
  })
})

type Def = typeof artifactsDefinition

function fold(events: { type: string; seq: number; time: number; data: Record<string, unknown> }[]) {
  const def: Def = artifactsDefinition
  let state: ReturnType<Def['start']> | undefined
  for (const event of events) {
    const match = def.match(event)
    if (match === null) continue
    state = match.role === 'start' && state === undefined ? def.start(undefined, { event }) : def.update({ state: state! }, { event })
  }
  return def.buildLocationData({ state }, 'turn', null)
}

describe('turn artifacts definition', () => {
  it('collects the latest version per artifact from tool results', () => {
    const data = fold([
      { type: 'turn/start', seq: 0, time: 0, data: { turn: 3 } },
      { type: 'tool/call', seq: 1, time: 1, data: { turn: 3, callId: 'c1', name: 'artifact' } },
      { type: 'tool/result', seq: 2, time: 2, data: { turn: 3, message: { toolCallId: 'c1', isError: false }, meta: meta(1) } },
      { type: 'tool/call', seq: 3, time: 3, data: { turn: 3, callId: 'c2', name: 'artifact' } },
      { type: 'tool/result', seq: 4, time: 4, data: { turn: 3, message: { toolCallId: 'c2', isError: false }, meta: meta(2) } },
      { type: 'tool/call', seq: 5, time: 5, data: { turn: 3, callId: 'c3', name: 'other_tool' } },
      { type: 'tool/result', seq: 6, time: 6, data: { turn: 3, message: { toolCallId: 'c3', isError: false }, meta: meta(9, 'spoof') } },
    ])
    expect(data).toMatchObject({ kind: 'turn', turn: 3, key: 'dshArtifacts' })
    expect((data as unknown as { value: { artifacts: { meta: ArtifactMeta }[] } }).value.artifacts.map(a => [a.meta.id, a.meta.version])).toEqual([['app', 2]])
  })

  it('accepts plugin records and ignores duplicates of the same version', () => {
    const data = fold([
      { type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } },
      { type: RECORD_TYPE, seq: 1, time: 1, data: { ...meta(1), turn: 1, callId: 'n1' } },
      { type: 'tool/call', seq: 2, time: 2, data: { turn: 1, callId: 'n1', name: 'artifact' } },
      { type: 'tool/result', seq: 3, time: 3, data: { turn: 1, message: { toolCallId: 'n1', isError: false }, meta: meta(1) } },
    ])
    const artifacts = (data as unknown as { value: { artifacts: { meta: ArtifactMeta; callId: string }[] } }).value.artifacts
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]!.callId).toBe('n1')
  })

  it('publishes nothing for turns without artifacts or for failed calls', () => {
    expect(fold([
      { type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } },
      { type: 'tool/call', seq: 1, time: 1, data: { turn: 1, callId: 'c1', name: 'artifact' } },
      { type: 'tool/result', seq: 2, time: 2, data: { turn: 1, message: { toolCallId: 'c1', isError: true }, meta: meta(1) } },
    ])).toBeNull()
  })
})

describe('index cache', () => {
  it('rebuilds from a log after an earlier read found nothing', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = await mkdtemp(join(tmpdir(), 'dsha-cache-'))
    try {
      const store = new ArtifactStore(dir)
      expect(await store.history('s', 'app')).toEqual([])
      const log = () => [{ type: RECORD_TYPE, time: 1, data: { ...meta(1), turn: 1, callId: 'c' } }]
      expect((await store.history('s', 'app', log)).map(v => v.version)).toEqual([1])
      expect((await new ArtifactStore(dir).history('s', 'app')).map(v => v.version)).toEqual([1])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
