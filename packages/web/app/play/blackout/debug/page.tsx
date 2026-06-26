"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { MatchDto } from "@/lib/blackout/dto";

/**
 * Minimal JSON debug harness for the Blackout match API (M4b). Not the
 * polished board (that's M4c against this same API) — just enough surface
 * to create a real testnet match, watch the AI Phantom generate real ZK
 * proofs, and submit human Investigator moves, with the raw DTO visible.
 */
export default function BlackoutDebugPage() {
  const [investigators, setInvestigators] = useState(3);
  const [aiInvestigators, setAiInvestigators] = useState(2);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [state, setState] = useState<MatchDto | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moveNode, setMoveNode] = useState("");
  const [moveTicket, setMoveTicket] = useState("0");

  const run = useCallback(async (label: string, fn: () => Promise<Response>) => {
    setBusy(label);
    setError(null);
    try {
      const res = await fn();
      const json = (await res.json()) as MatchDto | { error: string };
      if (!res.ok) {
        setError("error" in json ? json.error : `request failed (${res.status})`);
        return;
      }
      setState(json as MatchDto);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, []);

  const createMatch = useCallback(async () => {
    setBusy("create");
    setError(null);
    setState(null);
    setMatchId(null);
    try {
      const res = await fetch("/api/blackout/matches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ investigators, aiInvestigators }),
      });
      const json = (await res.json()) as { matchId: string; state: MatchDto } | { error: string };
      if (!res.ok || !("matchId" in json)) {
        setError("error" in json ? json.error : `request failed (${res.status})`);
        return;
      }
      setMatchId(json.matchId);
      setState(json.state);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, [investigators, aiInvestigators]);

  const refresh = useCallback(() => {
    if (!matchId) return;
    void run("refresh", () => fetch(`/api/blackout/matches/${matchId}`));
  }, [matchId, run]);

  const aiTurn = useCallback(() => {
    if (!matchId) return;
    void run("ai-turn", () => fetch(`/api/blackout/matches/${matchId}/ai-turn`, { method: "POST" }));
  }, [matchId, run]);

  const submitMove = useCallback(() => {
    if (!matchId || !state?.currentPlayer) return;
    const node = Number(moveNode);
    const ticket = Number(moveTicket);
    void run("move", () =>
      fetch(`/api/blackout/matches/${matchId}/moves`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ player: state.currentPlayer!.index, node, ticket }),
      }),
    );
  }, [matchId, state, moveNode, moveTicket, run]);

  const isHumanTurn = state?.currentPlayer && !state.currentPlayer.isAi;

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <Link
        href="/play/blackout"
        className="inline-flex items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Blackout
      </Link>

      <h1 className="mt-6 font-display text-2xl font-bold text-fg">Blackout API debug</h1>
      <p className="mt-2 text-sm text-fg-muted">
        Raw JSON harness for the M4b match API — real testnet deploys, real ZK proofs for every
        Phantom move. The polished board lives at <code>/play/blackout</code> (M4c).
      </p>

      <div className="mt-6 flex flex-wrap items-end gap-4 rounded-[var(--radius-lg)] border border-border bg-bg-panel p-4">
        <label className="flex flex-col gap-1 text-xs text-fg-muted">
          investigators
          <input
            type="number"
            min={1}
            max={5}
            value={investigators}
            onChange={(e) => setInvestigators(Number(e.target.value))}
            className="w-20 rounded border border-border-strong bg-bg px-2 py-1 text-sm text-fg"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-fg-muted">
          aiInvestigators
          <input
            type="number"
            min={0}
            max={investigators}
            value={aiInvestigators}
            onChange={(e) => setAiInvestigators(Number(e.target.value))}
            className="w-20 rounded border border-border-strong bg-bg px-2 py-1 text-sm text-fg"
          />
        </label>
        <Button onClick={createMatch} disabled={busy !== null}>
          {busy === "create" ? "Deploying (~15-30s)…" : "Create match"}
        </Button>
        {matchId && (
          <>
            <Button variant="outline" onClick={refresh} disabled={busy !== null}>
              {busy === "refresh" ? "Refreshing…" : "Refresh"}
            </Button>
            <Button variant="outline" onClick={aiTurn} disabled={busy !== null}>
              {busy === "ai-turn" ? "Playing AI turns…" : "Advance AI turns"}
            </Button>
          </>
        )}
      </div>

      {matchId && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
          <Badge variant="accent">match {matchId.slice(0, 8)}</Badge>
          {state && (
            <a
              href={state.explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="text-accent underline underline-offset-2"
            >
              referee on stellar.expert
            </a>
          )}
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-[var(--radius-sm)] border border-hidden/40 bg-hidden/10 p-3 text-sm text-hidden-strong">
          {error}
        </div>
      )}

      {isHumanTurn && state?.currentPlayer && (
        <div className="mt-6 rounded-[var(--radius-lg)] border border-accent/40 bg-accent/5 p-4">
          <p className="text-sm text-fg">
            Your turn — <span className="font-mono">{state.currentPlayer.id}</span> (player{" "}
            {state.currentPlayer.index})
          </p>
          <p className="mt-1 text-xs text-fg-muted">
            legal moves:{" "}
            <span className="font-mono">
              {(state.currentPlayer.legalMoves ?? [])
                .map((m) => `${String(m.to)}/${String(m.ticket)}`)
                .join(", ") || "(none)"}
            </span>
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-fg-muted">
              node
              <input
                value={moveNode}
                onChange={(e) => setMoveNode(e.target.value)}
                className="w-24 rounded border border-border-strong bg-bg px-2 py-1 text-sm text-fg"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-fg-muted">
              ticket (0=taxi,1=bus,2=rail)
              <input
                value={moveTicket}
                onChange={(e) => setMoveTicket(e.target.value)}
                className="w-24 rounded border border-border-strong bg-bg px-2 py-1 text-sm text-fg"
              />
            </label>
            <Button onClick={submitMove} disabled={busy !== null}>
              {busy === "move" ? "Submitting…" : "Submit move"}
            </Button>
          </div>
        </div>
      )}

      {state && (
        <pre className="mt-6 max-h-[32rem] overflow-auto rounded-[var(--radius-lg)] border border-border bg-bg-panel p-4 text-xs text-fg-muted">
          {JSON.stringify(state, null, 2)}
        </pre>
      )}
    </div>
  );
}
