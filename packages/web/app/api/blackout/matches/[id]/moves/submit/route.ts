import { NextResponse } from "next/server";
import { BlackoutApiError } from "@/lib/blackout/errors";
import { advanceAiTurns, fetchDto, requireMatch, submitSignedHumanMove } from "@/lib/blackout/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Sending the signed move + however many AI turns follow (each a real
// testnet tx, the Phantom's a real proof + tx) can take a while.
export const maxDuration = 300;

type SubmitBody = { player?: unknown; node?: unknown; ticket?: unknown; signedXdr?: unknown };

/**
 * POST /api/blackout/matches/[id]/moves/submit — lands a Freighter-signed
 * `submit_public_move` envelope (from `.../moves/prepare`), then
 * auto-advances every consecutive AI turn, exactly like POST .../moves.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as SubmitBody | null;
  if (
    !body ||
    typeof body.player !== "number" ||
    typeof body.node !== "number" ||
    typeof body.ticket !== "number" ||
    typeof body.signedXdr !== "string"
  ) {
    return NextResponse.json(
      { error: "request body must be { player: number, node: number, ticket: number, signedXdr: string }" },
      { status: 400 },
    );
  }

  try {
    const match = requireMatch(id);
    await submitSignedHumanMove(match, {
      player: body.player,
      node: body.node,
      ticket: body.ticket,
      signedXdr: body.signedXdr,
    });
    await advanceAiTurns(match);
    return NextResponse.json(await fetchDto(match));
  } catch (err) {
    const status = err instanceof BlackoutApiError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
