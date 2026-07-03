import { NextResponse } from "next/server";
import { CoupApiError } from "@/lib/coup-lite/errors";
import { coupDto, requireCoupMatch } from "@/lib/coup-lite/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    return NextResponse.json(await coupDto(requireCoupMatch(id)));
  } catch (err) {
    const status = err instanceof CoupApiError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
