import { NextResponse } from "next/server";
import { BlackoutApiError } from "@/lib/blackout/errors";
import { advanceAiTurns, fetchDto, requireMatch } from "@/lib/blackout/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/blackout/matches/[id]/ai-turn — advance AI turns without a
 * human move first. Used when the match opens on the Phantom's turn (every
 * match does — Phantom always moves first), or to drive an all-AI demo.
 * Stops the moment it's a human seat's turn, or the match ends.
 */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const match = await requireMatch(id);
    await advanceAiTurns(match);
    return NextResponse.json(await fetchDto(match, { reuseCachedState: true }));
  } catch (err) {
    const status = err instanceof BlackoutApiError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
