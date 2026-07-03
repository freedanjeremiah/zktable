import { NextResponse } from "next/server";
import { CoupApiError } from "@/lib/coup-lite/errors";
import { coupDto, requireCoupMatch, submitHumanChallenge } from "@/lib/coup-lite/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** POST /api/coup-lite/matches/[id]/challenge — challenge the standing claim; resolve on-chain. */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const match = requireCoupMatch(id);
    await submitHumanChallenge(match);
    return NextResponse.json(await coupDto(match, { reuseCachedState: true }));
  } catch (err) {
    const status = err instanceof CoupApiError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
