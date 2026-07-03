import { NextResponse } from "next/server";
import { BlackoutApiError } from "@/lib/blackout/errors";
import { advanceAiTurns, fetchDto, requireMatch, submitPhantomReveal } from "@/lib/blackout/orchestrator";
import { readSessionToken } from "@/lib/blackout/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Body = { node?: unknown; saltHex?: unknown };

/**
 * POST /api/blackout/matches/[id]/phantom-reveal — lands the browser's
 * reveal `(node, salt)` at a reveal checkpoint (public by design at that
 * moment; the referee checks it against the stored commitment).
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body || typeof body.node !== "number" || typeof body.saltHex !== "string") {
    return NextResponse.json({ error: "request body must be { node: number, saltHex: string }" }, { status: 400 });
  }

  try {
    const match = await requireMatch(id);
    await submitPhantomReveal(match, { node: body.node, saltHex: body.saltHex, sessionToken: readSessionToken(request) });
    await advanceAiTurns(match);
    return NextResponse.json(await fetchDto(match));
  } catch (err) {
    const status = err instanceof BlackoutApiError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
