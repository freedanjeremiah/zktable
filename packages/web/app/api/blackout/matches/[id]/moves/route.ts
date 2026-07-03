import { NextResponse } from "next/server";
import { BlackoutApiError } from "@/lib/blackout/errors";
import { advanceAiTurns, fetchDto, requireMatch, submitHumanMove } from "@/lib/blackout/orchestrator";
import { readSessionToken } from "@/lib/blackout/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A human move + however many AI turns follow (each a real testnet tx, the
// Phantom's a real proof + tx) can take a while.
export const maxDuration = 300;

type MoveBody = { player?: unknown; node?: unknown; ticket?: unknown };

/**
 * POST /api/blackout/matches/[id]/moves — submit the human Investigator's
 * public move `{ player, node, ticket }` (all numeric; `player` is the
 * chain player index from the DTO's `players[].index` /
 * `currentPlayer.index`). Validates legality against the local mirror,
 * submits `submit_public_move`, then auto-advances every consecutive AI
 * turn (Phantom hidden move with a REAL proof, AI Investigator public
 * moves) until it's a human's turn again or the match ends.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as MoveBody | null;
  if (
    !body ||
    typeof body.player !== "number" ||
    typeof body.node !== "number" ||
    typeof body.ticket !== "number"
  ) {
    return NextResponse.json(
      { error: "request body must be { player: number, node: number, ticket: number }" },
      { status: 400 },
    );
  }

  try {
    const match = await requireMatch(id);
    await submitHumanMove(match, {
      player: body.player,
      node: body.node,
      ticket: body.ticket,
      sessionToken: readSessionToken(request),
    });
    await advanceAiTurns(match);
    return NextResponse.json(await fetchDto(match, { reuseCachedState: true }));
  } catch (err) {
    const status = err instanceof BlackoutApiError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
