/** The model-facing `artifact` tool. */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ArtifactCommand, ArtifactMeta, ArtifactRecord, ArtifactType } from '../shared/types.ts'
import { ARTIFACT_TYPES, ID_PATTERN, normalizeType, TOOL_NAME } from '../shared/types.ts'
import type { ArtifactStore, LogEvent } from './store.ts'

export interface ToolOptions {
  /** Maximum UTF-8 bytes of one artifact's content. */
  readonly maxBytes: number
  /** Whether `window.claude.complete` is advertised to the model. */
  readonly ai: boolean
  /** Called after a version is stored, with the execution identity (for `tools/result` correlation). */
  readonly onCommitted?: ((exec: object, meta: ArtifactMeta, session: unknown) => void) | undefined
}

/** Build the tool description the model reads. */
export function toolDescription(options: Pick<ToolOptions, 'ai'>): string {
  const lines = [
    'Create and iterate on artifacts: substantial, self-contained content shown to the user in a side panel and rendered live — web pages, interactive React apps, SVG graphics, Mermaid diagrams, Markdown documents, and code files. The user can switch between versions, view the source, copy, download, and open it in a new browser tab.',
    '',
    'Use an artifact when the content is substantial (roughly more than 15 lines) and the user is likely to keep, reuse, iterate on, or interact with it: an app, game, dashboard, calculator, simulation, data visualization, diagram, report, long-form document, or standalone script. Do not use one for short answers, conversational replies, brief code snippets, or content that only makes sense inline. Usually make at most one artifact per response. To change files in the user\'s project, use file tools instead.',
    '',
    'Commands:',
    '- create: a new artifact. Requires id (short kebab-case, e.g. "budget-planner"), type, title and content.',
    '- update: in the latest version, replace one exact, unique occurrence of old_str with new_str. Best for small edits; old_str must match character for character, including whitespace.',
    '- rewrite: replace the whole content (and optionally title or type). Use it for large changes.',
    'Keep the same id while iterating; every call creates a new version. Content must be complete — never use placeholders like "// rest of the code".',
    '',
    'Types:',
    '- html: a complete single-file HTML page with inline CSS and JS. External scripts/styles may be loaded from https CDNs (cdnjs, jsdelivr, unpkg).',
    '- react: one React component file (JSX or TSX) whose default export renders with no required props. Style with Tailwind utility classes (avoid arbitrary values like h-[600px]). Import hooks from "react". Any npm package can be imported by its name and is fetched from a CDN, e.g. lucide-react, recharts, d3, three, lodash, mathjs, papaparse, xlsx, chart.js, tone. Basic shadcn/ui components are available from "@/components/ui/<name>". Do not use localStorage or sessionStorage (unavailable in the sandbox); keep state in React or window.storage.',
    '- svg: one <svg> element with a viewBox.',
    '- mermaid: Mermaid diagram source only, without code fences.',
    '- markdown: a formatted document. Supports GitHub-flavored Markdown, LaTeX math with $...$ and $$...$$, and ```mermaid code blocks.',
    '- code: a source file shown with syntax highlighting; set language (e.g. "python").',
    '',
    'Inside html and react artifacts (a sandboxed iframe with no access to the host page, cookies, or local files):',
    '- window.storage.get(key, shared?), .set(key, value, shared?), .delete(key, shared?), .list(prefix?, shared?) return Promises. Values are strings (JSON.stringify objects). Data persists per artifact across versions and reloads. Wrap calls in try/catch.',
  ]
  if (options.ai) {
    lines.push('- window.claude.complete(prompt) (alias window.dsh.complete) returns a Promise<string> answered by the language model. Use it for AI-powered features. Each call is independent: put all needed context in the prompt, and ask for JSON when you need structured output (then JSON.parse it defensively).')
  }
  return lines.join('\n')
}

/** Apply the command to the current record. Throws a model-readable Error on misuse. */
export function applyCommand(
  command: ArtifactCommand,
  current: ArtifactRecord | undefined,
  args: { id: string; type?: string | undefined; title?: string | undefined; language?: string | undefined; content?: string | undefined; old_str?: string | undefined; new_str?: string | undefined },
): { record: ArtifactRecord; note?: string } {
  const type = args.type === undefined ? undefined : normalizeType(args.type)
  if (args.type !== undefined && type === undefined) {
    throw new Error(`Unknown artifact type "${args.type}". Use one of: ${ARTIFACT_TYPES.join(', ')}.`)
  }
  const title = args.title?.trim()
  switch (command) {
    case 'create': {
      if (type === undefined) throw new Error('create requires type.')
      if (!title) throw new Error('create requires a non-empty title.')
      if (args.content === undefined || args.content.trim() === '') throw new Error('create requires non-empty content.')
      return {
        record: build(type, title, args.language, args.content),
        ...(current === undefined ? {} : { note: `An artifact with id "${args.id}" already existed; this created a new version of it. Use a different id for a separate artifact.` }),
      }
    }
    case 'rewrite': {
      if (current === undefined) throw new Error(`No artifact with id "${args.id}" exists in this session. Use create.`)
      if (args.content === undefined || args.content.trim() === '') throw new Error('rewrite requires the complete new content.')
      return { record: build(type ?? current.type, title || current.title, args.language ?? current.language, args.content) }
    }
    case 'update': {
      if (current === undefined) throw new Error(`No artifact with id "${args.id}" exists in this session. Use create.`)
      if (args.old_str === undefined || args.old_str === '') throw new Error('update requires a non-empty old_str (or use rewrite).')
      if (args.new_str === undefined) throw new Error('update requires new_str (use an empty string to delete text).')
      const count = countOccurrences(current.content, args.old_str)
      if (count === 0) {
        throw new Error(`old_str was not found in the latest version of "${args.id}". Copy it exactly from the current content (including whitespace and indentation), or use rewrite.`)
      }
      if (count > 1) {
        throw new Error(`old_str matches ${count} places in "${args.id}". Include more surrounding context so it matches exactly once.`)
      }
      const at = current.content.indexOf(args.old_str)
      const content = current.content.slice(0, at) + args.new_str + current.content.slice(at + args.old_str.length)
      return { record: build(type ?? current.type, title || current.title, args.language ?? current.language, content) }
    }
  }
}

function build(type: ArtifactType, title: string, language: string | undefined, content: string): ArtifactRecord {
  const lang = type === 'code' ? language?.trim() || undefined : undefined
  return { type, title: title.slice(0, 200), content, ...(lang === undefined ? {} : { language: lang }) }
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0
  let from = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at === -1) return count
    count += 1
    if (count > 1000) return count
    from = at + needle.length
  }
}

/** Minimal slice of the tool execution context this tool reads. */
interface ExecLike {
  readonly callId: string
  readonly agent?: { readonly id: string; readonly session: { snapshotEvents(): readonly LogEvent[] } }
}

/**
 * Create the tool definition.
 * @param store - artifact persistence.
 * @param options - limits and advertised capabilities.
 */
export function createArtifactTool(store: ArtifactStore, options: ToolOptions): ToolDefinition {
  return defineTool({
    name: TOOL_NAME,
    description: toolDescription(options),
    parameters: {
      command: { type: 'string', enum: ['create', 'update', 'rewrite'], required: true, description: 'create a new artifact, update part of the latest version, or rewrite it completely.' },
      id: { type: 'string', required: true, description: 'Stable identifier in kebab-case (e.g. "solar-system-sim"). Reuse it to update an artifact.' },
      type: { type: 'string', enum: [...ARTIFACT_TYPES], description: 'Artifact type. Required for create.' },
      title: { type: 'string', description: 'Short human-readable title. Required for create.' },
      language: { type: 'string', description: 'Programming language, for type "code".' },
      content: { type: 'string', description: 'Complete content, for create and rewrite.' },
      old_str: { type: 'string', description: 'For update: exact text to replace; must occur exactly once.' },
      new_str: { type: 'string', description: 'For update: replacement text.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sessionId: { type: 'string', required: true },
          id: { type: 'string', required: true },
          version: { type: 'integer', required: true },
          type: { type: 'string', required: true },
          title: { type: 'string', required: true },
          language: { type: 'string' },
          command: { type: 'string', required: true },
          sha: { type: 'string', required: true },
          bytes: { type: 'integer', required: true },
          lines: { type: 'integer', required: true },
          note: { type: 'string' },
        },
      },
      render: (_args, value) => {
        const verb = value.command === 'create' && value.version === 1 ? 'created' : 'updated'
        const lines = [
          `Artifact "${value.id}" ${verb}: version ${value.version}, ${value.type}, "${value.title}", ${value.lines} lines. It is displayed to the user in the artifact panel.`,
        ]
        if (value.note) lines.push(value.note)
        return [{ type: 'text', text: lines.join('\n') }]
      },
      presentationMeta: (_args, value) => {
        const { note: _note, ...meta } = value
        return meta
      },
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const context = exec as unknown as ExecLike
      if (context.agent === undefined) throw new Error('artifact requires an agent session.')
      const id = args.id.trim()
      if (!ID_PATTERN.test(id)) {
        throw new Error('id must be 1–64 characters of letters, digits, ".", "_" or "-", starting with a letter or digit (e.g. "budget-planner").')
      }
      const agent = context.agent
      const sessionId = agent.id
      const command = args.command as ArtifactCommand
      const log = () => agent.session.snapshotEvents()
      return store.serialize(`session:${sessionId}`, async () => {
        const versions = await store.history(sessionId, id, log)
        const latest = versions[versions.length - 1]
        const current = latest === undefined ? undefined : await store.getBlob(latest.sha)
        if (latest !== undefined && current === undefined) {
          throw new Error(`The stored content of "${id}" (version ${latest.version}) is missing on disk. Use create with a new id or rewrite with complete content.`)
        }
        const { record, note } = applyCommand(command, current, { ...args, id })
        const bytes = Buffer.byteLength(record.content, 'utf8')
        if (bytes > options.maxBytes) {
          throw new Error(`Artifact content is ${bytes} bytes, above the ${options.maxBytes}-byte limit. Make it smaller or split it.`)
        }
        const sha = await store.putBlob(record)
        const version = (latest?.version ?? 0) + 1
        const meta: ArtifactMeta = {
          sessionId,
          id,
          version,
          type: record.type,
          title: record.title,
          ...(record.language === undefined ? {} : { language: record.language }),
          command,
          sha,
          bytes,
          lines: record.content.split('\n').length,
        }
        await store.appendVersion(sessionId, id, {
          version, sha, type: record.type, title: record.title,
          ...(record.language === undefined ? {} : { language: record.language }),
          command, callId: context.callId, createdAt: Date.now(), bytes,
        }, log)
        options.onCommitted?.(exec, meta, agent.session)
        return { ...meta, ...(note === undefined ? {} : { note }) }
      })
    },
  })
}
