import { NextResponse } from "next/server";
import { BlackoutApiError } from "@/lib/blackout/errors";
import { fetchDto, joinOpenMatch, requireMatch } from "@/lib/blackout/orchestrator";
import { attachSessionCookie, getOrCreateSessionToken } from "@/lib/blackout/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/blackout/matches/[id]/join — claim the open human seat for this
 * browser's session (M8.4 lobby). Returns `{ playerId, state }`.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = getOrCreateSessionToken(request);
  try {
    const match = await requireMatch(id);
    const playerId = await joinOpenMatch(match, session.token);
    const response = NextResponse.json({ playerId, state: await fetchDto(match) });
    return session.isNew ? attachSessionCookie(response, session.token) : response;
  } catch (err) {
    const status = err instanceof BlackoutApiError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
