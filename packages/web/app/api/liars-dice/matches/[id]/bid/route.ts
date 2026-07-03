import { NextResponse } from "next/server";
import { LiarsApiError } from "@/lib/liars-dice/errors";
import { liarsDto, requireLiarsMatch, submitHumanBid } from "@/lib/liars-dice/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Body = { quantity?: unknown; face?: unknown };

/** POST /api/liars-dice/matches/[id]/bid — submit the human's bid, then AI responds. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body || typeof body.quantity !== "number" || typeof body.face !== "number") {
    return NextResponse.json({ error: "request body must be { quantity: number, face: number }" }, { status: 400 });
  }
  try {
    const match = requireLiarsMatch(id);
    await submitHumanBid(match, { quantity: body.quantity, face: body.face });
    return NextResponse.json(await liarsDto(match, { reuseCachedState: true }));
  } catch (err) {
    const status = err instanceof LiarsApiError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
