import type Anthropic from '@anthropic-ai/sdk'
import type { Move, PlayerView } from '@zktable/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClaudeAgent, DEFAULT_CLAUDE_AGENT_MODEL } from './claude-agent.js'

// No real Anthropic API calls are made anywhere in this file — `client` is
// always a hand-rolled fake whose `messages.create` is a vitest mock. No
// API key is required to run this suite.

function fakeMessage(content: Anthropic.ContentBlock[]): Anthropic.Message {
  return {
    id: 'msg_test',
    container: null,
    content,
    model: DEFAULT_CLAUDE_AGENT_MODEL,
    role: 'assistant',
    stop_details: null,
    stop_reason: 'tool_use',
    stop_sequence: null,
    type: 'message',
    usage: {
      cache_creation: null,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      inference_geo: null,
      input_tokens: 10,
      output_tokens: 10,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: null,
    },
  } as unknown as Anthropic.Message
}

function toolUseBlock(input: unknown): Anthropic.ContentBlock {
  return {
    type: 'tool_use',
    id: 'toolu_test',
    name: 'choose_move',
    input,
  } as unknown as Anthropic.ContentBlock
}

function textBlock(text: string): Anthropic.ContentBlock {
  return { type: 'text', text, citations: [] } as unknown as Anthropic.ContentBlock
}

function makeClient(create: (params: unknown) => Promise<Anthropic.Message>): Anthropic {
  return { messages: { create: vi.fn(create) } } as unknown as Anthropic
}

const view: PlayerView = {
  public: { board: Array(9).fill(null) },
  self: { id: 'p1', secret: {} },
  legalMoves: [],
}

const legalMoves: Move[] = [
  { type: 'place', cell: 0 },
  { type: 'place', cell: 1 },
  { type: 'place', cell: 2 },
]

describe('ClaudeAgent', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('returns the move at the tool-call index', async () => {
    const client = makeClient(async () => fakeMessage([toolUseBlock({ index: 2 })]))
    const agent = new ClaudeAgent({ client })

    await expect(agent.act(view, legalMoves)).resolves.toEqual({ type: 'place', cell: 2 })
  })

  it('defaults to DEFAULT_CLAUDE_AGENT_MODEL when no model is given', async () => {
    const create = vi.fn(async (_params: unknown) => fakeMessage([toolUseBlock({ index: 0 })]))
    const client = { messages: { create } } as unknown as Anthropic
    const agent = new ClaudeAgent({ client })

    await agent.act(view, legalMoves)

    expect(create).toHaveBeenCalledTimes(1)
    const params = create.mock.calls[0]![0] as { model: string }
    expect(params.model).toBe(DEFAULT_CLAUDE_AGENT_MODEL)
  })

  it('honors an explicit model override', async () => {
    const create = vi.fn(async (_params: unknown) => fakeMessage([toolUseBlock({ index: 0 })]))
    const client = { messages: { create } } as unknown as Anthropic
    const agent = new ClaudeAgent({ client, model: 'claude-opus-4-8' })

    await agent.act(view, legalMoves)

    const params = create.mock.calls[0]![0] as { model: string }
    expect(params.model).toBe('claude-opus-4-8')
  })

  it('uses a custom describeView to build the prompt', async () => {
    const create = vi.fn(async (_params: unknown) => fakeMessage([toolUseBlock({ index: 0 })]))
    const client = { messages: { create } } as unknown as Anthropic
    const agent = new ClaudeAgent({
      client,
      describeView: () => 'MARKER_TEXT_FOR_TEST',
    })

    await agent.act(view, legalMoves)

    const params = create.mock.calls[0]![0] as { messages: Array<{ content: string }> }
    expect(params.messages[0]!.content).toContain('MARKER_TEXT_FOR_TEST')
  })

  it('forces the choose_move tool via tool_choice', async () => {
    const create = vi.fn(async (_params: unknown) => fakeMessage([toolUseBlock({ index: 0 })]))
    const client = { messages: { create } } as unknown as Anthropic
    const agent = new ClaudeAgent({ client })

    await agent.act(view, legalMoves)

    const params = create.mock.calls[0]![0] as { tool_choice: { type: string; name: string } }
    expect(params.tool_choice).toEqual({ type: 'tool', name: 'choose_move' })
  })

  it('falls back to the first legal move when the index is out of range', async () => {
    const client = makeClient(async () => fakeMessage([toolUseBlock({ index: 99 })]))
    const agent = new ClaudeAgent({ client })

    await expect(agent.act(view, legalMoves)).resolves.toEqual(legalMoves[0])
    expect(warnSpy).toHaveBeenCalled()
  })

  it('falls back to the first legal move when the index is negative', async () => {
    const client = makeClient(async () => fakeMessage([toolUseBlock({ index: -1 })]))
    const agent = new ClaudeAgent({ client })

    await expect(agent.act(view, legalMoves)).resolves.toEqual(legalMoves[0])
  })

  it('falls back to the first legal move when the index is not an integer', async () => {
    const client = makeClient(async () => fakeMessage([toolUseBlock({ index: 1.5 })]))
    const agent = new ClaudeAgent({ client })

    await expect(agent.act(view, legalMoves)).resolves.toEqual(legalMoves[0])
  })

  it('falls back to the first legal move when there is no tool_use block', async () => {
    const client = makeClient(async () => fakeMessage([textBlock("I'm not calling a tool.")]))
    const agent = new ClaudeAgent({ client })

    await expect(agent.act(view, legalMoves)).resolves.toEqual(legalMoves[0])
    expect(warnSpy).toHaveBeenCalled()
  })

  it('falls back to the first legal move when the API call throws, and never throws itself', async () => {
    const client = makeClient(async () => {
      throw new Error('network exploded')
    })
    const agent = new ClaudeAgent({ client })

    await expect(agent.act(view, legalMoves)).resolves.toEqual(legalMoves[0])
    expect(warnSpy).toHaveBeenCalled()
  })

  it('never returns a move outside legalMoves, even from a malformed response', async () => {
    const client = makeClient(async () => fakeMessage([toolUseBlock({ index: 'not-a-number' })]))
    const agent = new ClaudeAgent({ client })

    const move = await agent.act(view, legalMoves)
    expect(legalMoves).toContainEqual(move)
  })
})
