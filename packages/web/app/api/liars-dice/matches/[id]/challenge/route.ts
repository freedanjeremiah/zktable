import { NextResponse } from "next/server";
import { LiarsApiError } from "@/lib/liars-dice/errors";
import { liarsDto, requireLiarsMatch, submitHumanChallenge } from "@/lib/liars-dice/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** POST /api/liars-dice/matches/[id]/challenge — challenge the standing bid; reveal + resolve. */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const match = requireLiarsMatch(id);
    await submitHumanChallenge(match);
    return NextResponse.json(await liarsDto(match, { reuseCachedState: true }));
  } catch (err) {
    const status = err instanceof LiarsApiError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
