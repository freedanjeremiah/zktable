import { NextResponse } from "next/server";
import { BlackoutApiError } from "@/lib/blackout/errors";
import { completeSignedStart, fetchDto, requireMatch } from "@/lib/blackout/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type StartBody = { signedXdr?: unknown };

/**
 * POST /api/blackout/matches/[id]/start-signed — lands the wallet-signed
 * `set_public_start` envelope (the DTO's `pendingStart.xdr`, signed with
 * Freighter), then `start()`s the match. The Phantom is then on the clock —
 * call POST .../ai-turn next.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as StartBody | null;
  if (!body || typeof body.signedXdr !== "string") {
    return NextResponse.json({ error: "request body must be { signedXdr: string }" }, { status: 400 });
  }

  try {
    const match = await requireMatch(id);
    await completeSignedStart(match, body.signedXdr);
    return NextResponse.json(await fetchDto(match));
  } catch (err) {
    const status = err instanceof BlackoutApiError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
