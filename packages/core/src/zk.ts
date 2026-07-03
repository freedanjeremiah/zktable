// The `zk` namespace: typed placeholder factories for ZK-aware game
// components and move bindings.
//
// **M1 status: these are INERT MARKERS.** Every function here just returns a
// small tagged descriptor object (`{ __zk: '<tag>', ...args }`). The engine
// never interprets these — `components` on a `GameDefinition` is `opaque`,
// and `MoveSpec.zkp` is ignored entirely in M1. A game can freely use `zk.*`
// today to describe hidden state/components/move bindings; nothing crypto
// happens until the corresponding module milestone (M2+) replaces these
// factories with real commitment/proof-producing implementations behind the
// same call shape, so game definitions do not need to change.
//
// Each descriptor's `__zk` tag matches the dotted call path that produced it
// (e.g. `zk.board.graph(...)` -> `{ __zk: 'board.graph', ... }`), which lets
// later milestones dispatch on the tag without re-deriving it.

export type ZkMarker = { __zk: string } & Record<string, unknown>

export const zk = {
  board: {
    /** Public graph/grid component (e.g. a transit map). Inert until §7.1 `board`. */
    graph(data: unknown): ZkMarker {
      return { __zk: 'board.graph', data }
    },
    /** Binds a move to "prove legal movement along `component`'s graph". Inert until §7.1 `board`. */
    moveAlong(component: string, opts: Record<string, unknown> = {}): ZkMarker {
      return { __zk: 'board.moveAlong', component, opts }
    },
  },

  hidden: {
    /** A secret graph-node position, never revealed except at a reveal checkpoint. Inert until §7.1/§7.4. */
    node(): ZkMarker {
      return { __zk: 'hidden.node' }
    },
    /** A secret scalar value. Inert until §7.4 `hidden`. */
    value(): ZkMarker {
      return { __zk: 'hidden.value' }
    },
  },

  public: {
    /** A visible (non-hidden) graph-node position. */
    node(): ZkMarker {
      return { __zk: 'public.node' }
    },
  },

  dice: {
    /** Declares a dice pool component. Inert until §7.3 `dice`. */
    pool(opts: Record<string, unknown> = {}): ZkMarker {
      return { __zk: 'dice.pool', opts }
    },
    /** Rolls `n` dice whose values stay hidden until revealed. Inert until §7.3 `dice`. */
    rollHidden(n: number): ZkMarker {
      return { __zk: 'dice.rollHidden', n }
    },
  },

  deck: {
    /** Declares a shuffleable deck component from a card list. Inert until §7.2 `deck`. */
    of(cards: unknown[]): ZkMarker {
      return { __zk: 'deck.of', cards }
    },
    /** Deals `n` cards, held privately per player. Inert until §7.2 `deck`. */
    deal(n: number): ZkMarker {
      return { __zk: 'deck.deal', n }
    },
    /** Binds a shuffle to "prove the deck is the canonical set in the seed-forced order" (`valid_shuffle`, REAL on-chain as of M8.3 — seed commit-reveal + position-assigned hands in the coup-referee; see ADR 009). The marker itself stays declarative in the local engine, like every `zk.*` marker. */
    shuffle(): ZkMarker {
      return { __zk: 'deck.shuffle' }
    },
    /** Binds a move to "prove a claimed card is held (or the challenge reveals a bluff)" (`card_membership`) — REAL on-chain since M6.3 (Coup-lite's load-bearing `prove_hold`). The marker itself stays declarative in the local engine. */
    proveHoldOrBluff(): ZkMarker {
      return { __zk: 'deck.proveHoldOrBluff' }
    },
  },

  sealed: {
    /** Binds a move to simultaneous commit-then-reveal semantics. Inert until §7.5 `sealed`. */
    commit(): ZkMarker {
      return { __zk: 'sealed.commit' }
    },
  },

  reveal: {
    /** Marks `path` (dot-path into secret state) as the target of a reveal checkpoint. Inert until §7.1/§7.5. */
    all(path: string): ZkMarker {
      return { __zk: 'reveal.all', path }
    },
  },

  /** Declares a countable per-player resource pool (e.g. movement tickets). Inert marker; wiring lands in M2+. */
  resource(counts: Record<string, number>): ZkMarker {
    return { __zk: 'resource', counts }
  },
}
