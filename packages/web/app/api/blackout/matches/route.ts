import { NextResponse } from "next/server";
import { BlackoutApiError } from "@/lib/blackout/errors";
import { listOpenMatches } from "@/lib/blackout/match-store";
import { createBlackoutMatch } from "@/lib/blackout/orchestrator";
import { attachSessionCookie, getOrCreateSessionToken } from "@/lib/blackout/session";

// Deploys real contracts to Stellar testnet and shells out to `nargo`/`bb` —
// Node runtime only, never Edge; not statically cacheable.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A real deploy (verifier + referee + N `join` calls) is ~15-30s; give it room.
export const maxDuration = 300;

type CreateMatchBody = {
  investigators?: number;
  aiInvestigators?: number;
  model?: string;
  /** Freighter G-address that will own the human investigator seat. */
  walletAddress?: string;
  /** List the match in the open lobby with its human seat unclaimed. */
  open?: boolean;
  /** 'human' seats the Phantom as a browser-proving human (M8.5). */
  phantomSeat?: "ai" | "human";
};

/** GET /api/blackout/matches — open matches waiting for a human to join. */
export async function GET() {
  try {
    return NextResponse.json({ matches: await listOpenMatches() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

/**
 * POST /api/blackout/matches — deploys a fresh `move_along` verifier +
 * referee on testnet, joins 1 AI Phantom + N Investigators (some human by
 * default), and starts the match. Slow (real testnet deploys); the returned
 * state has the Phantom on the clock — call POST .../ai-turn next.
 */
export async function POST(request: Request) {
  let body: CreateMatchBody = {};
  try {
    const text = await request.text();
    if (text.trim().length > 0) body = JSON.parse(text) as CreateMatchBody;
  } catch {
    return NextResponse.json({ error: "request body must be valid JSON" }, { status: 400 });
  }

  const requestTag = new Date().toISOString();
  const session = getOrCreateSessionToken(request);
  try {
    const dto = await createBlackoutMatch({
      investigators: body.investigators,
      aiInvestigators: body.aiInvestigators,
      model: body.model,
      walletAddress: typeof body.walletAddress === "string" ? body.walletAddress : undefined,
      open: body.open === true,
      phantomSeat: body.phantomSeat === "human" ? "human" : "ai",
      sessionToken: session.token,
      log: (line) => console.log(`[blackout:create ${requestTag}]`, line),
    });
    const response = NextResponse.json({
      matchId: dto.matchId,
      refereeId: dto.refereeId,
      explorerUrl: dto.explorerUrl,
      state: dto,
    });
    return session.isNew ? attachSessionCookie(response, session.token) : response;
  } catch (err) {
    const status = err instanceof BlackoutApiError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
