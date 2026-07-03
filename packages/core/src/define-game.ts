import type { Game, GameDefinition } from './types.js'

/**
 * Validate a `GameDefinition` and compile it into a `Game`. Throws a clear,
 * descriptive error on any structural problem so authoring mistakes are
 * caught immediately rather than surfacing as confusing engine failures.
 */
export function defineGame(def: GameDefinition): Game {
  if (!def || typeof def !== 'object') {
    throw new Error('defineGame: definition must be an object')
  }

  if (typeof def.name !== 'string' || def.name.trim().length === 0) {
    throw new Error('defineGame: "name" must be a non-empty string')
  }

  const { players } = def
  if (!players || typeof players.min !== 'number' || typeof players.max !== 'number') {
    throw new Error('defineGame: "players.min" and "players.max" must be numbers')
  }
  if (players.min < 1) {
    throw new Error('defineGame: "players.min" must be at least 1')
  }
  if (players.max < players.min) {
    throw new Error('defineGame: "players.max" must be >= "players.min"')
  }
  if (players.roles !== undefined) {
    if (!Array.isArray(players.roles) || players.roles.length === 0) {
      throw new Error('defineGame: "players.roles", if provided, must be a non-empty array')
    }
  }

  if (!def.state || typeof def.state.public !== 'function') {
    throw new Error('defineGame: "state.public" must be a function')
  }
  if (def.state.secret !== undefined && typeof def.state.secret !== 'function') {
    throw new Error('defineGame: "state.secret", if provided, must be a function')
  }

  if (!def.turn || typeof def.turn !== 'object') {
    throw new Error('defineGame: "turn" is required')
  }

  const order = def.turn.order
  const orderIsValid =
    order === 'clockwise' || order === 'roles' || typeof order === 'function'
  if (!orderIsValid) {
    throw new Error(
      "defineGame: \"turn.order\" must be 'clockwise', 'roles', or a function",
    )
  }
  if (order === 'roles' && (!players.roles || players.roles.length === 0)) {
    throw new Error(
      'defineGame: "turn.order" is \'roles\' but "players.roles" was not declared',
    )
  }

  if (def.turn.eliminated !== undefined && typeof def.turn.eliminated !== 'function') {
    throw new Error('defineGame: "turn.eliminated", if provided, must be a function')
  }

  const moveEntries = Object.entries(def.turn.moves ?? {})
  if (moveEntries.length === 0) {
    throw new Error('defineGame: "turn.moves" must declare at least one move')
  }
  for (const [moveName, spec] of moveEntries) {
    if (!spec || typeof spec !== 'object') {
      throw new Error(`defineGame: move "${moveName}" must be an object`)
    }
    if (typeof spec.legal !== 'function') {
      throw new Error(`defineGame: move "${moveName}" is missing a "legal" function`)
    }
    if (typeof spec.apply !== 'function') {
      throw new Error(`defineGame: move "${moveName}" is missing an "apply" function`)
    }
  }

  if (typeof def.end !== 'function') {
    throw new Error('defineGame: "end" must be a function')
  }

  if (def.setup !== undefined && typeof def.setup !== 'function') {
    throw new Error('defineGame: "setup", if provided, must be a function')
  }

  if (def.reveal !== undefined) {
    if (typeof def.reveal.when !== 'function' || !Array.isArray(def.reveal.what)) {
      throw new Error(
        'defineGame: "reveal", if provided, must have a "when" function and a "what" array',
      )
    }
  }

  return { def }
}
