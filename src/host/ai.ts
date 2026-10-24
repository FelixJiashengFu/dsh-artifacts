/**
 * `window.claude.complete(prompt)` for artifacts: one stateless, tool-free
 * model request on the deployment's default model (or a configured route).
 * These requests never enter the agent's context.
 */
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'

export interface AiOptions {
  readonly enabled: boolean
  readonly provider?: string | undefined
  readonly model?: string | undefined
  readonly maxTokens: number
  readonly maxPromptChars: number
  readonly maxCallsPerMinute: number
  readonly timeoutMs: number
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** A prompt sent by an artifact through `window.claude.complete`. */
    'dsh-artifacts': Record<never, never>
  }
}

/** One chat-style turn accepted from artifacts that pass a message array. */
interface TurnInput {
  readonly role?: unknown
  readonly content?: unknown
}

/** Normalize the artifact's input (string, or a Claude-style messages array) into one prompt. */
export function promptText(input: unknown): string {
  if (typeof input === 'string') return input
  if (Array.isArray(input)) {
    const turns = (input as TurnInput[]).map((turn) => {
      const role = turn.role === 'assistant' ? 'Assistant' : 'User'
      const content = typeof turn.content === 'string'
        ? turn.content
        : Array.isArray(turn.content)
          ? (turn.content as { text?: unknown }[]).map(part => typeof part.text === 'string' ? part.text : '').join('')
          : ''
      return `${role}: ${content}`
    })
    return `${turns.join('\n\n')}\n\nAssistant:`
  }
  if (input !== null && typeof input === 'object' && typeof (input as { prompt?: unknown }).prompt === 'string') {
    return (input as { prompt: string }).prompt
  }
  throw new Error('complete() expects a prompt string.')
}

export class ArtifactAi {
  private readonly windows = new Map<string, number[]>()

  constructor(private readonly ctx: Context, private readonly options: AiOptions) {}

  get enabled(): boolean {
    return this.options.enabled
  }

  private route(): { provider: string; model: string } {
    if (this.options.provider && this.options.model) return { provider: this.options.provider, model: this.options.model }
    const defaults = this.ctx.get('agentDefaultModel') as { currentSelection(): { provider: string; model: string } } | undefined
    const selection = defaults?.currentSelection()
    if (selection?.provider && selection.model) return { provider: selection.provider, model: selection.model }
    throw new Error('No model is configured for artifact AI calls. Set ai.provider and ai.model in the dsh-artifacts config.')
  }

  private admit(key: string): void {
    const now = Date.now()
    const recent = (this.windows.get(key) ?? []).filter(t => now - t < 60_000)
    if (recent.length >= this.options.maxCallsPerMinute) {
      throw new Error(`Rate limit: at most ${this.options.maxCallsPerMinute} AI calls per minute per artifact.`)
    }
    recent.push(now)
    this.windows.set(key, recent)
  }

  /**
   * Answer one prompt.
   * @param sessionId - Session that owns the artifact (telemetry attribution).
   * @param artifactId - artifact identity (rate-limit bucket).
   * @param input - prompt string or messages array.
   * @param signal - request cancellation.
   */
  async complete(sessionId: string, artifactId: string, input: unknown, signal: AbortSignal): Promise<string> {
    if (!this.options.enabled) throw new Error('AI calls from artifacts are disabled in this deployment.')
    const text = promptText(input)
    if (text.trim() === '') throw new Error('The prompt is empty.')
    if (text.length > this.options.maxPromptChars) {
      throw new Error(`The prompt has ${text.length} characters, above the ${this.options.maxPromptChars}-character limit.`)
    }
    this.admit(`${sessionId}\u0000${artifactId}`)
    const llm = this.ctx.get('llm') as {
      prepareCall(config: { provider: string; model: string; maxTokens?: number }, signal?: AbortSignal): Promise<{
        readonly config: { provider: string; model: string }
        stream(options: GenerateOptions): AsyncIterable<{ type: string; text?: string; reason?: { kind: string; failure?: { message: string } } }>
      }>
    } | undefined
    if (llm === undefined) throw new Error('No language model service is available.')
    const timeout = AbortSignal.timeout(this.options.timeoutMs)
    const combined = AbortSignal.any([signal, timeout])
    const route = this.route()
    const call = await llm.prepareCall({ ...route, maxTokens: this.options.maxTokens }, combined)
    const options = {
      ...call.config,
      messages: [createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'dsh-artifacts' } })],
      sessionId,
      signal: combined,
    } as unknown as GenerateOptions
    let out = ''
    for await (const chunk of call.stream(options)) {
      combined.throwIfAborted()
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') out += chunk.text
      if (chunk.type === 'finish' && (chunk.reason?.kind === 'error' || chunk.reason?.kind === 'aborted')) {
        throw new Error(chunk.reason.failure?.message ?? 'The model request failed.')
      }
    }
    return out
  }
}
