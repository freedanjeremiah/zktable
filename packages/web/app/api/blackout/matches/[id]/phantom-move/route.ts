import { NextResponse } from "next/server";
import { BlackoutApiError } from "@/lib/blackout/errors";
import { advanceAiTurns, fetchDto, requireMatch, submitPhantomMove } from "@/lib/blackout/orchestrator";
import { readSessionToken } from "@/lib/blackout/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The signed move + the AI investigator turns that follow are real testnet txs.
export const maxDuration = 300;

type Body = { cNewHex?: unknown; ticket?: unknown; proofHex?: unknown };

/**
 * POST /api/blackout/matches/[id]/phantom-move — lands a BROWSER-proven
 * hidden move (M8.5): `{ cNewHex, ticket, proofHex }` only. The on-chain
 * referee's proof verification is the legality check (the server cannot
 * check what it cannot see), then AI turns auto-advance as usual.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body || typeof body.cNewHex !== "string" || typeof body.ticket !== "number" || typeof body.proofHex !== "string") {
    return NextResponse.json(
      { error: "request body must be { cNewHex: string, ticket: number, proofHex: string }" },
      { status: 400 },
    );
  }

  try {
    const match = await requireMatch(id);
    const { round } = await submitPhantomMove(match, {
      cNewHex: body.cNewHex,
      ticket: body.ticket,
      proofHex: body.proofHex,
      sessionToken: readSessionToken(request),
    });
    // On a reveal round the Phantom must reveal BEFORE investigators move
    // (capture is resolved at reveal against their CURRENT positions) — the
    // browser follows up with POST .../phantom-reveal, which advances AI.
    const isRevealRound = (match.config.revealRounds ?? []).includes(round);
    if (!isRevealRound) await advanceAiTurns(match);
    return NextResponse.json(await fetchDto(match));
  } catch (err) {
    const status = err instanceof BlackoutApiError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
