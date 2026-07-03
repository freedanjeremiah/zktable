import { NextResponse } from "next/server";
import { BlackoutApiError } from "@/lib/blackout/errors";
import { prepareHumanMove, requireMatch } from "@/lib/blackout/orchestrator";
import { readSessionToken } from "@/lib/blackout/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type PrepareBody = { player?: unknown; node?: unknown; ticket?: unknown };

/**
 * POST /api/blackout/matches/[id]/moves/prepare — builds the UNSIGNED
 * `submit_public_move` envelope for the wallet-bound human seat. The
 * browser signs the returned `xdr` with Freighter and posts it to
 * `.../moves/submit`.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as PrepareBody | null;
  if (!body || typeof body.player !== "number" || typeof body.node !== "number" || typeof body.ticket !== "number") {
    return NextResponse.json(
      { error: "request body must be { player: number, node: number, ticket: number }" },
      { status: 400 },
    );
  }

  try {
    const match = await requireMatch(id);
    const { xdr } = await prepareHumanMove(match, {
      player: body.player,
      node: body.node,
      ticket: body.ticket,
      sessionToken: readSessionToken(request),
    });
    return NextResponse.json({ xdr });
  } catch (err) {
    const status = err instanceof BlackoutApiError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
