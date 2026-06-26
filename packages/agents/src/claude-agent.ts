import Anthropic from '@anthropic-ai/sdk'
import type { Move, PlayerView } from '@zktable/core'
import type { Agent, GameEvent } from './types.js'

// ClaudeAgent — an AI opponent backed by the Claude API. It sees exactly
// what any other `Agent` sees (a `PlayerView`: public state + only its OWN
// secret) and, like every agent in this package, is constrained to return
// one of the enumerated `legalMoves`. The move is selected via tool use
// (`choose_move`, an INDEX into `legalMoves`) rather than free-form text, so
// the model structurally cannot name a move that doesn't exist — indexing
// is validated again on our side regardless.
//
// SECURITY: this class holds an Anthropic API key (directly or via the
// injected `client`) and must only ever be constructed server-side (e.g.
// from the M4 server route that drives AI seats). Never import/construct
// `ClaudeAgent` in browser/client code — that would ship the API key to the
// browser.

export type ClaudeAgentOptions = {
  /** Pre-built Anthropic client (e.g. for tests, or to share one client across agents). Takes priority over `apiKey`. */
  client?: Anthropic
  /** API key to build a client from, if `client` is not given. Falls back to `ANTHROPIC_API_KEY` via the SDK's own default resolution when omitted. */
  apiKey?: string
  /** Claude model id. Defaults to a fast model — see `DEFAULT_CLAUDE_AGENT_MODEL`. */
  model?: string
  /** Optional system prompt (persona, house rules, tone). */
  system?: string
  /** Render a `PlayerView` into the text Claude sees. Defaults to a compact JSON-ish summary. */
  describeView?: (view: PlayerView) => string
  temperature?: number
}

/**
 * Fast, low-latency, low-cost current model — appropriate for in-game move
 * selection (PRD §10.3: "use a fast model in-game"). Confirmed via the
 * `claude-api` skill (cached 2026-06-24): `claude-haiku-4-5`, 200K context,
 * $1/$5 per MTok. Override with the `model` constructor option for a
 * stronger (slower, pricier) opponent, e.g. `claude-opus-4-8`.
 */
export const DEFAULT_CLAUDE_AGENT_MODEL = 'claude-haiku-4-5'

const CHOOSE_MOVE_TOOL_NAME = 'choose_move'

const CHOOSE_MOVE_TOOL: Anthropic.Tool = {
  name: CHOOSE_MOVE_TOOL_NAME,
  description:
    'Choose the move to play by its index into the numbered list of legal moves given in the prompt. You MUST pick an index that is in range.',
  input_schema: {
    type: 'object',
    properties: {
      index: {
        type: 'integer',
        description: 'Zero-based index into the legal-moves list of the move to play.',
      },
      reasoning: {
        type: 'string',
        description: 'Optional short reasoning (or bluff/table-talk) explaining the choice.',
      },
    },
    required: ['index'],
  },
}

export class ClaudeAgent implements Agent {
  private readonly client: Anthropic
  private readonly model: string
  private readonly system: string | undefined
  private readonly describeView: (view: PlayerView) => string
  private readonly temperature: number | undefined

  constructor(opts: ClaudeAgentOptions = {}) {
    this.client = opts.client ?? new Anthropic({ apiKey: opts.apiKey })
    this.model = opts.model ?? DEFAULT_CLAUDE_AGENT_MODEL
    this.system = opts.system
    this.describeView = opts.describeView ?? defaultDescribeView
    this.temperature = opts.temperature
  }

  async act(view: PlayerView, legalMoves: Move[]): Promise<Move> {
    if (legalMoves.length === 0) {
      throw new Error('ClaudeAgent.act: no legal moves to choose from')
    }
    // Safe default: never leave the game loop without a legal move, no
    // matter what goes wrong talking to the API.
    const fallback = legalMoves[0]!

    let message: Anthropic.Message
    try {
      message = await this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        ...(this.system !== undefined ? { system: this.system } : {}),
        ...(this.temperature !== undefined ? { temperature: this.temperature } : {}),
        tools: [CHOOSE_MOVE_TOOL],
        tool_choice: { type: 'tool', name: CHOOSE_MOVE_TOOL_NAME },
        messages: [{ role: 'user', content: this.buildPrompt(view, legalMoves) }],
      })
    } catch (err) {
      warn('API call failed; falling back to the first legal move', err)
      return fallback
    }

    const toolUse = message.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === 'tool_use' && block.name === CHOOSE_MOVE_TOOL_NAME,
    )
    if (!toolUse) {
      warn('response contained no choose_move tool call; falling back to the first legal move')
      return fallback
    }

    const index = (toolUse.input as { index?: unknown } | null)?.index
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= legalMoves.length) {
      warn(`model returned an out-of-range/invalid index (${JSON.stringify(index)}); falling back to the first legal move`)
      return fallback
    }

    return legalMoves[index]!
  }

  observe(_event: GameEvent): void {
    // No-op: ClaudeAgent is stateless across turns today. A future version
    // could fold observed events into the prompt for table-talk/bluffing.
  }

  private buildPrompt(view: PlayerView, legalMoves: Move[]): string {
    const numberedMoves = legalMoves
      .map((move, i) => `${i}: ${JSON.stringify(move)}`)
      .join('\n')
    return [
      this.describeView(view),
      '',
      'Legal moves (choose ONE by its index):',
      numberedMoves,
      '',
      `Call the "${CHOOSE_MOVE_TOOL_NAME}" tool with the index of the move you want to play.`,
    ].join('\n')
  }
}

function defaultDescribeView(view: PlayerView): string {
  const lines = [
    `Public state: ${JSON.stringify(view.public)}`,
    `You are player "${view.self.id}"${view.self.role ? ` (role: ${view.self.role})` : ''}.`,
    `Your private secret (only you can see this): ${JSON.stringify(view.self.secret)}`,
  ]
  if (view.tickets) {
    lines.push(`Your resources: ${JSON.stringify(view.tickets)}`)
  }
  return lines.join('\n')
}

function warn(message: string, err?: unknown): void {
  // eslint-disable-next-line no-console
  console.warn(`ClaudeAgent.act: ${message}`, err ?? '')
}
