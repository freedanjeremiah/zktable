import { NextResponse } from "next/server";
import { CoupApiError } from "@/lib/coup-lite/errors";
import { createCoupMatch } from "@/lib/coup-lite/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** POST /api/coup-lite/matches — deploy a real testnet match (verifiers +
 *  referee + seed commit-reveal + valid_shuffle proof + position deal). */
export async function POST() {
  const tag = new Date().toISOString();
  try {
    const dto = await createCoupMatch({ log: (l) => console.log(`[coup:create ${tag}]`, l) });
    return NextResponse.json({ matchId: dto.matchId, refereeId: dto.refereeId, explorerUrl: dto.explorerUrl, state: dto });
  } catch (err) {
    const status = err instanceof CoupApiError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
