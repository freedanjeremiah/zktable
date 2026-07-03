import { NextResponse } from "next/server";
import { LiarsApiError } from "@/lib/liars-dice/errors";
import { createLiarsMatch } from "@/lib/liars-dice/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** POST /api/liars-dice/matches — deploy a real testnet match (deploy +
 *  seed commit-reveal + both dice_valid proofs) and return the DTO. */
export async function POST() {
  const tag = new Date().toISOString();
  try {
    const dto = await createLiarsMatch({ log: (l) => console.log(`[liars:create ${tag}]`, l) });
    return NextResponse.json({ matchId: dto.matchId, refereeId: dto.refereeId, explorerUrl: dto.explorerUrl, state: dto });
  } catch (err) {
    const status = err instanceof LiarsApiError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
