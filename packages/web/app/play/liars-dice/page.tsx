"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Dice5 } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateProgress } from "@/components/board/create-progress";
import type { LiarsDto } from "@/lib/liars-dice/dto";
import { cn } from "@/lib/utils";

type Phase = "setup" | "creating" | "active" | "finished";

const PIPS = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

async function readJson<T>(res: Response): Promise<T> {
  const json = (await res.json()) as T | { error: string };
  if (!res.ok) throw new Error(json && typeof json === "object" && "error" in json ? json.error : `request failed (${res.status})`);
  return json as T;
}

export default function LiarsDicePage() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [matchId, setMatchId] = useState<string | null>(null);
  const [dto, setDto] = useState<LiarsDto | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createStartedAt, setCreateStartedAt] = useState<number | null>(null);
  const [bidQty, setBidQty] = useState(1);
  const [bidFace, setBidFace] = useState(1);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("match");
    if (!id) return;
    void (async () => {
      try {
        const state = await readJson<LiarsDto>(await fetch(`/api/liars-dice/matches/${id}`));
        setMatchId(id);
        setDto(state);
        setPhase(state.outcome ? "finished" : "active");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setPhase("creating");
    setCreateStartedAt(Date.now());
    try {
      const json = await readJson<{ matchId: string; state: LiarsDto }>(
        await fetch("/api/liars-dice/matches", { method: "POST" }),
      );
      setMatchId(json.matchId);
      setDto(json.state);
      setPhase(json.state.outcome ? "finished" : "active");
      window.history.replaceState(null, "", `/play/liars-dice?match=${json.matchId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("setup");
    }
  }, []);

  const applyNext = useCallback((next: LiarsDto) => {
    setDto(next);
    if (next.outcome) setPhase("finished");
  }, []);

  const submitBid = useCallback(async () => {
    if (!matchId) return;
    setError(null);
    setBusy("Submitting your bid + proving the AI's response on-chain…");
    try {
      const next = await readJson<LiarsDto>(
        await fetch(`/api/liars-dice/matches/${matchId}/bid`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ quantity: bidQty, face: bidFace }),
        }),
      );
      applyNext(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, [matchId, bidQty, bidFace, applyNext]);

  const submitChallenge = useCallback(async () => {
    if (!matchId) return;
    setError(null);
    setBusy("Challenging — revealing every die on-chain…");
    try {
      const next = await readJson<LiarsDto>(
        await fetch(`/api/liars-dice/matches/${matchId}/challenge`, { method: "POST" }),
      );
      applyNext(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, [matchId, applyNext]);

  const cur = dto?.currentBid ?? null;
  const yourTurn = Boolean(dto && dto.currentIsHuman && !dto.outcome && !busy);
  const human = dto?.players.find((p) => p.isHuman);
  const ai = dto?.players.find((p) => p.isAi);

  // Keep the bid selector at or above the minimum legal bid.
  useEffect(() => {
    if (!cur) return;
    setBidQty((q) => Math.max(q, cur.quantity));
  }, [cur]);

  const bidIsLegal = useMemo(() => {
    if (!cur) return bidQty >= 1;
    return bidQty > cur.quantity || (bidQty === cur.quantity && bidFace > cur.face);
  }, [cur, bidQty, bidFace]);

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <Link href="/arcade" className="inline-flex items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to arcade
      </Link>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl font-bold tracking-tight text-fg">Liar&rsquo;s Dice</h1>
        <Badge variant="outline">Stellar Testnet</Badge>
        {matchId ? <Badge variant="accent" className="font-mono">{matchId.slice(0, 8)}</Badge> : null}
      </div>

      {error ? (
        <p className="mt-4 rounded-[var(--radius-md)] border border-danger/40 bg-danger/10 px-4 py-2.5 text-sm text-danger">{error}</p>
      ) : null}

      {phase === "setup" ? (
        <Card className="mt-8 max-w-xl">
          <CardHeader>
            <CardTitle>New match</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-[0.95rem] leading-relaxed text-fg-muted">
              You and one AI each get five hidden dice, each roll a real{" "}
              <span className="font-mono text-fg">dice_valid</span> proof verified on Stellar testnet. Escalate the
              public bid or call the bluff — a challenge reveals every die on-chain and settles it.
            </p>
            <Button variant="primary" size="lg" onClick={() => void start()}>
              <Dice5 className="h-4 w-4" /> Deploy a real match
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {phase === "creating" && createStartedAt ? (
        <div className="mt-8 max-w-xl">
          <CreateProgress label="Deploying the referee + proving both rolls on testnet…" startedAt={createStartedAt} />
        </div>
      ) : null}

      {(phase === "active" || phase === "finished") && dto && human && ai ? (
        <div className="mt-8 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">The table · {dto.totalDice} dice total</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                {/* AI dice — hidden until reveal */}
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-semibold text-fg">AI opponent</span>
                    {!ai.alive ? <Badge variant="outline">out</Badge> : null}
                  </div>
                  <div className="flex gap-2">
                    {Array.from({ length: ai.diceCount }).map((_, i) => (
                      <span key={i} className="text-4xl leading-none text-fg-subtle">
                        {ai.dice ? PIPS[ai.dice[i]!] : "🎲"}
                      </span>
                    ))}
                  </div>
                  {ai.dice ? null : <p className="mt-1 text-xs text-fg-subtle">hidden until a challenge</p>}
                </div>

                <div className="rounded-[var(--radius-md)] border border-border bg-bg-panel px-4 py-3 text-center">
                  {cur ? (
                    <span className="font-mono text-lg text-fg">
                      Standing bid: {cur.quantity} × {PIPS[cur.face]} <span className="text-fg-subtle">(face {cur.face})</span>
                    </span>
                  ) : (
                    <span className="text-sm text-fg-muted">No bid yet — open the bidding.</span>
                  )}
                </div>

                {/* Your dice — always visible */}
                <div>
                  <div className="mb-2 text-sm font-semibold text-accent">Your dice</div>
                  <div className="flex gap-2">
                    {(human.dice ?? []).map((d, i) => (
                      <span key={i} className="text-4xl leading-none text-accent">{PIPS[d]}</span>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {phase === "finished" && dto.outcome ? (
              <Card>
                <CardContent className="flex flex-col items-center gap-3 py-8">
                  <span className="text-2xl font-bold text-fg">
                    {dto.outcome.index === human.index ? "You win 🎉" : "AI wins"}
                  </span>
                  <a href={dto.explorerUrl} target="_blank" rel="noreferrer" className="font-mono text-xs text-accent underline">
                    view referee on stellar.expert →
                  </a>
                  <Button variant="outline" size="md" onClick={() => { window.location.href = "/play/liars-dice"; }}>New match</Button>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{yourTurn ? "Your move" : busy ? "Working…" : "AI is thinking…"}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  {busy ? <p className="text-sm text-fg-muted">{busy}</p> : null}
                  <div className={cn("flex flex-wrap items-end gap-4", !yourTurn && "pointer-events-none opacity-50")}>
                    <label className="flex flex-col gap-1 text-xs text-fg-subtle">
                      Quantity
                      <input
                        type="number"
                        min={cur ? cur.quantity : 1}
                        max={dto.totalDice}
                        value={bidQty}
                        onChange={(e) => setBidQty(Math.max(1, Number(e.target.value)))}
                        className="h-9 w-20 rounded-[var(--radius-sm)] border border-border-strong bg-bg-elevated px-3 font-mono text-sm text-fg"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-fg-subtle">
                      Face
                      <select
                        value={bidFace}
                        onChange={(e) => setBidFace(Number(e.target.value))}
                        className="h-9 w-24 rounded-[var(--radius-sm)] border border-border-strong bg-bg-elevated px-2 font-mono text-sm text-fg"
                      >
                        {Array.from({ length: dto.sides }, (_, i) => i + 1).map((f) => (
                          <option key={f} value={f}>{PIPS[f]} {f}</option>
                        ))}
                      </select>
                    </label>
                    <Button variant="primary" size="md" disabled={!yourTurn || !bidIsLegal} onClick={() => void submitBid()}>
                      Bid
                    </Button>
                    <Button variant="outline" size="md" disabled={!yourTurn || !cur} onClick={() => void submitChallenge()}>
                      Challenge
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Move log</CardTitle>
            </CardHeader>
            <CardContent className="max-h-96 overflow-y-auto text-sm">
              <ul className="flex flex-col gap-1.5">
                {[...dto.log].reverse().map((e, i) => (
                  <li key={i} className="text-fg-muted">
                    {e.type === "roll" && <span>{e.player} rolled (ZK-proven fair)</span>}
                    {e.type === "bid" && <span className="text-fg">{e.player} bid {e.quantity} × face {e.face}</span>}
                    {e.type === "challenge" && <span className="text-accent">{e.player} challenged!</span>}
                    {e.type === "reveal" && <span>{e.player} revealed [{e.dice.join(", ")}]</span>}
                    {e.type === "error" && <span className="text-danger">{e.message}</span>}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
