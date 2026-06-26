import { defineGame } from '../define-game.js'
import type { MatchState, Move, Outcome, PlayerId, PlayerView } from '../types.js'

// Fully-public 2-player tic-tac-toe: the reference game proving the engine
// handles turn order, legal-move enumeration, submit/apply, and end
// detection with no secrets and no ZK bindings whatsoever.

type Mark = 'X' | 'Y'
type Cell = Mark | null

const LINES: Array<[number, number, number]> = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
]

function board(view: PlayerView): Cell[] {
  return view.public.board as Cell[]
}

function winner(cells: Cell[]): Mark | null {
  for (const [a, b, c] of LINES) {
    const mark = cells[a]
    if (mark && mark === cells[b] && mark === cells[c]) return mark
  }
  return null
}

export const ticTacToe = defineGame({
  name: 'tic-tac-toe',
  players: { min: 2, max: 2 },

  state: {
    public: (ctx) => {
      const marks: Record<PlayerId, Mark> = {}
      const seatMarks: Mark[] = ['X', 'Y']
      ctx.players.forEach((p, i) => {
        marks[p.id] = seatMarks[i]!
      })
      return { board: Array<Cell>(9).fill(null), marks }
    },
  },

  turn: {
    order: 'clockwise',
    moves: {
      place: {
        legal: (view: PlayerView): Move[] =>
          board(view).flatMap((cell, i) => (cell === null ? [{ type: 'place', cell: i }] : [])),
        apply: (state: MatchState, move: Move, ctx): MatchState => {
          const cell = move.cell as number
          const marks = state.public.marks as Record<PlayerId, Mark>
          const mark = marks[ctx.playerId]!
          const nextBoard = [...(state.public.board as Cell[])]
          nextBoard[cell] = mark
          return { ...state, public: { ...state.public, board: nextBoard } }
        },
      },
    },
  },

  end: (state: MatchState): Outcome | null => {
    const cells = state.public.board as Cell[]
    const marks = state.public.marks as Record<PlayerId, Mark>
    const win = winner(cells)
    if (win) {
      const winningPlayer = Object.entries(marks).find(([, m]) => m === win)?.[0]
      return winningPlayer ? { winner: winningPlayer } : null
    }
    if (cells.every((c) => c !== null)) {
      return { winner: 'draw' }
    }
    return null
  },
})
