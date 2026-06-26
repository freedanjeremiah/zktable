import { describe, expect, it } from 'vitest'
import { zk } from './zk.js'

describe('zk markers', () => {
  it('board.graph returns an inert descriptor tagging the graph data', () => {
    const data = { nodes: [1, 2], edges: [] }
    const marker = zk.board.graph(data)
    expect(marker).toEqual({ __zk: 'board.graph', data })
  })

  it('board.moveAlong tags the component name and options', () => {
    const marker = zk.board.moveAlong('map', { announce: 'ticket', prove: 'legal-edge' })
    expect(marker).toEqual({
      __zk: 'board.moveAlong',
      component: 'map',
      opts: { announce: 'ticket', prove: 'legal-edge' },
    })
  })

  it('hidden.node returns a tagged descriptor with no args', () => {
    expect(zk.hidden.node()).toEqual({ __zk: 'hidden.node' })
  })

  it('hidden.value returns a tagged descriptor with no args', () => {
    expect(zk.hidden.value()).toEqual({ __zk: 'hidden.value' })
  })

  it('public.node returns a tagged descriptor with no args', () => {
    expect(zk.public.node()).toEqual({ __zk: 'public.node' })
  })

  it('dice.pool tags its options', () => {
    expect(zk.dice.pool({ sides: 6 })).toEqual({ __zk: 'dice.pool', opts: { sides: 6 } })
  })

  it('dice.rollHidden tags the die count', () => {
    expect(zk.dice.rollHidden(5)).toEqual({ __zk: 'dice.rollHidden', n: 5 })
  })

  it('deck.of tags the card list', () => {
    const cards = ['duke', 'assassin']
    expect(zk.deck.of(cards)).toEqual({ __zk: 'deck.of', cards })
  })

  it('deck.deal tags the deal count', () => {
    expect(zk.deck.deal(2)).toEqual({ __zk: 'deck.deal', n: 2 })
  })

  it('sealed.commit returns a tagged descriptor with no args', () => {
    expect(zk.sealed.commit()).toEqual({ __zk: 'sealed.commit' })
  })

  it('reveal.all tags the path', () => {
    expect(zk.reveal.all('phantom.pos')).toEqual({ __zk: 'reveal.all', path: 'phantom.pos' })
  })

  it('resource tags the counts map', () => {
    const counts = { taxi: 10, bus: 8 }
    expect(zk.resource(counts)).toEqual({ __zk: 'resource', counts })
  })

  it('every marker is an opaque object the engine does not interpret', () => {
    const marker = zk.hidden.node()
    expect(typeof marker).toBe('object')
    expect('__zk' in marker).toBe(true)
  })
})
