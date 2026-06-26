import { NextResponse } from "next/server";
import { BlackoutApiError } from "@/lib/blackout/errors";
import { createBlackoutMatch } from "@/lib/blackout/orchestrator";

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
};

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
  try {
    const dto = await createBlackoutMatch({
      investigators: body.investigators,
      aiInvestigators: body.aiInvestigators,
      model: body.model,
      log: (line) => console.log(`[blackout:create ${requestTag}]`, line),
    });
    return NextResponse.json({
      matchId: dto.matchId,
      refereeId: dto.refereeId,
      explorerUrl: dto.explorerUrl,
      state: dto,
    });
  } catch (err) {
    const status = err instanceof BlackoutApiError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
