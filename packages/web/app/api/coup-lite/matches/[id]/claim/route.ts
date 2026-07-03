import { NextResponse } from "next/server";
import { CoupApiError } from "@/lib/coup-lite/errors";
import { coupDto, requireCoupMatch, submitHumanClaim } from "@/lib/coup-lite/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Body = { character?: unknown };

/** POST /api/coup-lite/matches/[id]/claim — claim a character, then AI responds. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body || typeof body.character !== "number") {
    return NextResponse.json({ error: "request body must be { character: number }" }, { status: 400 });
  }
  try {
    const match = requireCoupMatch(id);
    await submitHumanClaim(match, body.character);
    return NextResponse.json(await coupDto(match, { reuseCachedState: true }));
  } catch (err) {
    const status = err instanceof CoupApiError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
