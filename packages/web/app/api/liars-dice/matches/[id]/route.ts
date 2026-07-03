import { NextResponse } from "next/server";
import { LiarsApiError } from "@/lib/liars-dice/errors";
import { liarsDto, requireLiarsMatch } from "@/lib/liars-dice/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    return NextResponse.json(await liarsDto(requireLiarsMatch(id)));
  } catch (err) {
    const status = err instanceof LiarsApiError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
