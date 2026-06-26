// Public types for the `board` ZK module — hidden movement on a public graph.

export type Ticket = 0 | 1 | 2 // taxi | bus | rail

export type GraphEdge = {
  from: number
  to: number
  ticket: Ticket
}

export type GraphData = {
  nodes: number[]
  edges: GraphEdge[]
  /** Expand each edge to both directions. Defaults to true. */
  bidirectional?: boolean
}

export type BoardMove = {
  from: number
  to: number
  ticket: Ticket
  saltOld: bigint
  saltNew: bigint
}

export type BoardProof = {
  /** UltraHonk proof bytes (14592 bytes). */
  proof: Uint8Array
  /** c_old | c_new | ticket | root, 32 bytes each = 128 bytes total. */
  publicInputs: Uint8Array
  cOld: string
  cNew: string
  root: string
  ticket: Ticket
}
