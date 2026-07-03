import { NextResponse } from "next/server";
import { BlackoutApiError } from "@/lib/blackout/errors";
import { fetchDto, requireMatch, submitPhantomStart } from "@/lib/blackout/orchestrator";
import { readSessionToken } from "@/lib/blackout/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Body = { commitmentHex?: unknown };

/**
 * POST /api/blackout/matches/[id]/phantom-start — lands the BROWSER-generated
 * hidden-start commitment for a human-Phantom match (M8.5) and starts it.
 * The position and salt never reach the server.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body || typeof body.commitmentHex !== "string") {
    return NextResponse.json({ error: "request body must be { commitmentHex: string }" }, { status: 400 });
  }

  try {
    const match = await requireMatch(id);
    await submitPhantomStart(match, { commitmentHex: body.commitmentHex, sessionToken: readSessionToken(request) });
    return NextResponse.json(await fetchDto(match));
  } catch (err) {
    const status = err instanceof BlackoutApiError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
