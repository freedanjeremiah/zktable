"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Skull } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateProgress } from "@/components/board/create-progress";
import type { CoupDto } from "@/lib/coup-lite/dto";
import { cn } from "@/lib/utils";

type Phase = "setup" | "creating" | "active" | "finished";

async function readJson<T>(res: Response): Promise<T> {
  const json = (await res.json()) as T | { error: string };
  if (!res.ok) throw new Error(json && typeof json === "object" && "error" in json ? json.error : `request failed (${res.status})`);
  return json as T;
}

export default function CoupLitePage() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [matchId, setMatchId] = useState<string | null>(null);
  const [dto, setDto] = useState<CoupDto | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createStartedAt, setCreateStartedAt] = useState<number | null>(null);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("match");
    if (!id) return;
    void (async () => {
      try {
        const state = await readJson<CoupDto>(await fetch(`/api/coup-lite/matches/${id}`));
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
      const json = await readJson<{ matchId: string; state: CoupDto }>(await fetch("/api/coup-lite/matches", { method: "POST" }));
      setMatchId(json.matchId);
      setDto(json.state);
      setPhase(json.state.outcome ? "finished" : "active");
      window.history.replaceState(null, "", `/play/coup-lite?match=${json.matchId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("setup");
    }
  }, []);

  const post = useCallback(
    async (path: string, body?: unknown, label?: string) => {
      if (!matchId) return;
      setError(null);
      setBusy(label ?? "Working on-chain…");
      try {
        const next = await readJson<CoupDto>(
          await fetch(`/api/coup-lite/matches/${matchId}${path}`, {
            method: "POST",
            headers: body ? { "content-type": "application/json" } : {},
            body: body ? JSON.stringify(body) : undefined,
          }),
        );
        setDto(next);
        if (next.outcome) setPhase("finished");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    },
    [matchId],
  );

  const human = dto?.players.find((p) => p.isHuman);
  const ai = dto?.players.find((p) => !p.isHuman);
  const yourTurn = Boolean(dto && dto.currentIsHuman && !dto.outcome && !busy && dto.phase === "Playing");
  const canChallenge = Boolean(dto && dto.lastClaim && ai && dto.lastClaim.player === ai.index);
  const name = (c: number) => dto?.characterNames[c] ?? `#${c}`;

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <Link href="/arcade" className="inline-flex items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to arcade
      </Link>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl font-bold tracking-tight text-fg">Coup-lite</h1>
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
              A provably-fair deal (<span className="font-mono text-fg">valid_shuffle</span>{" "}proof on testnet)
              gives you and one AI a hidden two-card hand. Claim a character&rsquo;s power, or challenge theirs — a
              truthful claim is proven with a real <span className="font-mono text-fg">card_membership</span>{" "}proof;
              a bluff costs an influence.
            </p>
            <Button variant="primary" size="lg" onClick={() => void start()}>
              <Skull className="h-4 w-4" /> Deploy a real match
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {phase === "creating" && createStartedAt ? (
        <div className="mt-8 max-w-xl">
          <CreateProgress label="Deploying verifiers + referee, proving the shuffle on testnet…" startedAt={createStartedAt} />
        </div>
      ) : null}

      {(phase === "active" || phase === "finished") && dto && human && ai ? (
        <div className="mt-8 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">The table</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                {/* AI */}
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-semibold text-fg">AI opponent · {ai.influence} influence</span>
                    {!ai.alive ? <Badge variant="outline">out</Badge> : null}
                  </div>
                  <div className="flex gap-2">
                    {ai.dead.map((dead, i) => (
                      <span key={i} className="flex h-16 w-11 items-center justify-center rounded-[var(--radius-sm)] border border-border-strong bg-bg-panel text-xs text-fg-subtle">
                        {dead ? "💀" : "🂠"}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="rounded-[var(--radius-md)] border border-border bg-bg-panel px-4 py-3 text-center">
                  {dto.lastClaim ? (
                    <span className="font-mono text-fg">
                      {dto.players[dto.lastClaim.player]?.isHuman ? "You" : "AI"} claim{dto.players[dto.lastClaim.player]?.isHuman ? "" : "s"}: {name(dto.lastClaim.character)}
                    </span>
                  ) : (
                    <span className="text-sm text-fg-muted">No standing claim.</span>
                  )}
                </div>

                {/* Human */}
                <div>
                  <div className="mb-2 text-sm font-semibold text-accent">Your hand · {human.influence} influence</div>
                  <div className="flex gap-2">
                    {(human.hand ?? []).map((c, i) => (
                      <span key={i} className={cn("flex h-16 w-24 items-center justify-center rounded-[var(--radius-sm)] border text-sm", human.dead[i] ? "border-border bg-bg-panel text-fg-subtle line-through" : "border-accent/50 bg-accent/10 text-accent")}>
                        {name(c)}
                      </span>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {phase === "finished" && dto.outcome ? (
              <Card>
                <CardContent className="flex flex-col items-center gap-3 py-8">
                  <span className="text-2xl font-bold text-fg">{dto.outcome.index === human.index ? "You win 🎉" : "AI wins"}</span>
                  <a href={dto.explorerUrl} target="_blank" rel="noreferrer" className="font-mono text-xs text-accent underline">view referee on stellar.expert →</a>
                  <Button variant="outline" size="md" onClick={() => { window.location.href = "/play/coup-lite"; }}>New match</Button>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{yourTurn ? "Your move" : busy ? "Working…" : "AI is thinking…"}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  {busy ? <p className="text-sm text-fg-muted">{busy}</p> : null}
                  <div className={cn("flex flex-col gap-3", !yourTurn && "pointer-events-none opacity-50")}>
                    <div>
                      <div className="mb-2 text-xs text-fg-subtle">Claim a character</div>
                      <div className="flex flex-wrap gap-2">
                        {dto.characterNames.map((cn_, c) => (
                          <Button key={c} variant="outline" size="md" disabled={!yourTurn} onClick={() => void post("/claim", { character: c }, `Claiming ${cn_} on-chain…`)}>
                            {cn_}
                          </Button>
                        ))}
                      </div>
                    </div>
                    <Button variant="primary" size="md" disabled={!yourTurn || !canChallenge} onClick={() => void post("/challenge", undefined, "Challenging — proving on-chain…")}>
                      Challenge the AI&rsquo;s claim
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
                    {e.type === "deal" && <span>provably-fair deal (valid_shuffle verified)</span>}
                    {e.type === "claim" && <span className="text-fg">{e.player} claims {name(e.character)}</span>}
                    {e.type === "challenge" && (
                      <span className="text-accent">
                        {e.challenger} challenged {e.target} — {e.claimWasTrue ? "TRUE (ZK-proven)" : "BLUFF"}; {e.loser} lost influence
                      </span>
                    )}
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
