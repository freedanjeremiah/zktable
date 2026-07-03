import { NextResponse } from "next/server";
import { BlackoutApiError } from "@/lib/blackout/errors";
import { fetchDto, requireMatch } from "@/lib/blackout/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/blackout/matches/[id] — the current client DTO for this match. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const match = await requireMatch(id);
    const dto = await fetchDto(match);
    return NextResponse.json(dto);
  } catch (err) {
    const status = err instanceof BlackoutApiError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
