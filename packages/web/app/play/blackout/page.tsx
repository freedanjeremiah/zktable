"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CantCheatNote } from "@/components/board/cant-cheat-note";
import { CreateProgress } from "@/components/board/create-progress";
import { EventLog } from "@/components/board/event-log";
import { Hud } from "@/components/board/hud";
import { MapLegend } from "@/components/board/map-legend";
import { OutcomePanel } from "@/components/board/outcome-panel";
import { ProofStatusCard, type ProofPhase } from "@/components/board/proof-status-card";
import { SetupPanel, type SetupOptions } from "@/components/board/setup-panel";
import { TicketFeed } from "@/components/board/ticket-feed";
import { TicketPickerDialog } from "@/components/board/ticket-picker-dialog";
import { TransitMap } from "@/components/board/transit-map";
import type { MatchDto } from "@/lib/blackout/dto";
import { CITY_GRAPH } from "@/lib/board/city-graph";
import { computeShadow, extractPhantomTickets } from "@/lib/board/shadow";
import type { Ticket } from "@/lib/board/ticket-meta";
import { DEFAULT_REVEAL_ROUNDS } from "@/lib/board/ticket-meta";
import { cn } from "@/lib/utils";

type Phase = "setup" | "creating" | "active" | "finished";

type PendingPick = { node: number; tickets: Ticket[] };

async function readJson<T>(res: Response): Promise<T> {
  const json = (await res.json()) as T | { error: string };
  if (!res.ok) {
    const message = json && typeof json === "object" && "error" in json ? json.error : `request failed (${res.status})`;
    throw new Error(message);
  }
  return json as T;
}

export default function BlackoutBoardPage() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [matchId, setMatchId] = useState<string | null>(null);
  const [explorerUrl, setExplorerUrl] = useState<string>("");
  const [dto, setDto] = useState<MatchDto | null>(null);
  const [humanPlayerId, setHumanPlayerId] = useState<string | null>(null);
  const [createStartedAt, setCreateStartedAt] = useState<number | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [proofPhase, setProofPhase] = useState<ProofPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [pendingPick, setPendingPick] = useState<PendingPick | null>(null);
  const revealCountRef = useRef(0);

  const reset = useCallback(() => {
    setPhase("setup");
    setMatchId(null);
    setDto(null);
    setHumanPlayerId(null);
    setBusyLabel(null);
    setProofPhase("idle");
    setError(null);
    setPendingPick(null);
    revealCountRef.current = 0;
  }, []);

  /** Drive every consecutive AI turn (the API already loops server-side; this is a thin
   *  client-side safety net in case the server ever stops mid-AI-run). */
  const runAiTurns = useCallback(async (id: string) => {
    setProofPhase("proving");
    setBusyLabel("Phantom is moving in the dark…");
    let latest: MatchDto | null = null;
    for (let i = 0; i < 4; i++) {
      const res = await fetch(`/api/blackout/matches/${id}/ai-turn`, { method: "POST" });
      latest = await readJson<MatchDto>(res);
      if (latest.status !== "active" || !latest.currentPlayer?.isAi) break;
    }
    if (!latest) return;
    setDto(latest);
    setProofPhase(latest.proofStatus?.ok === false ? "error" : "verified");
    setBusyLabel(null);
    if (latest.status === "finished") setPhase("finished");
    return latest;
  }, []);

  const handleStart = useCallback(
    async (options: SetupOptions) => {
      setError(null);
      setPhase("creating");
      setCreateStartedAt(Date.now());
      try {
        const res = await fetch("/api/blackout/matches", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            investigators: options.investigators,
            model: options.model || undefined,
          }),
        });
        const json = await readJson<{ matchId: string; explorerUrl: string; state: MatchDto }>(res);
        setMatchId(json.matchId);
        setExplorerUrl(json.explorerUrl);
        setDto(json.state);
        const human = json.state.players.find((p) => p.role === "investigator" && !p.isAi);
        setHumanPlayerId(human?.id ?? null);
        setPhase("active");
        // The Phantom always opens — advance it immediately so the board
        // never sits idle waiting on an AI seat.
        await runAiTurns(json.matchId);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPhase("setup");
      }
    },
    [runAiTurns],
  );

  const submitMove = useCallback(
    async (node: number, ticket: Ticket) => {
      if (!matchId || !dto?.currentPlayer) return;
      setError(null);
      setPendingPick(null);
      setBusyLabel("Submitting your move…");
      try {
        const res = await fetch(`/api/blackout/matches/${matchId}/moves`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ player: dto.currentPlayer.index, node, ticket }),
        });
        setProofPhase("proving");
        const next = await readJson<MatchDto>(res);
        setDto(next);
        setProofPhase(next.proofStatus?.ok === false ? "error" : "verified");
        setBusyLabel(null);
        if (next.status === "finished") {
          setPhase("finished");
          return;
        }
        if (next.currentPlayer?.isAi) {
          await runAiTurns(matchId);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setBusyLabel(null);
      }
    },
    [matchId, dto, runAiTurns],
  );

  const handleSelectNode = useCallback((node: number, tickets: Ticket[]) => {
    if (tickets.length > 1) {
      setPendingPick({ node, tickets });
    } else if (tickets[0] !== undefined) {
      void submitMove(node, tickets[0]);
    }
  }, [submitMove]);

  const investigatorCount = dto ? dto.players.filter((p) => p.role === "investigator").length : 0;
  const shadow = useMemo(() => {
    if (!dto) return new Set<number>();
    const phantomTickets = extractPhantomTickets(dto.ticketFeed, investigatorCount);
    return computeShadow(CITY_GRAPH, phantomTickets, dto.revealLog);
  }, [dto, investigatorCount]);

  const lastReveal = dto && dto.revealLog.length > 0 ? dto.revealLog[dto.revealLog.length - 1]! : null;
  const isHumanTurn = Boolean(dto?.currentPlayer && !dto.currentPlayer.isAi && !busyLabel);
  const humanPlayer = dto?.players.find((p) => p.id === humanPlayerId) ?? null;

  const turnLabel = !dto?.currentPlayer
    ? "Match finished"
    : dto.currentPlayer.id === humanPlayerId
      ? "Your move"
      : dto.currentPlayer.isAi
        ? `${dto.currentPlayer.role === "phantom" ? "Phantom" : "AI Investigator"} is acting…`
        : `Waiting on ${dto.currentPlayer.id}`;

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <Link
        href="/arcade"
        className="inline-flex items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to arcade
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl font-bold tracking-tight text-fg">Blackout</h1>
        <Badge variant="outline">Stellar Testnet</Badge>
        {matchId ? <Badge variant="accent" className="font-mono">{matchId.slice(0, 8)}</Badge> : null}
      </div>

      {error ? (
        <p className="mt-4 rounded-[var(--radius-md)] border border-danger/40 bg-danger/10 px-4 py-2.5 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {phase === "setup" ? (
        <div className="mt-8 max-w-xl">
          <SetupPanel onStart={handleStart} />
        </div>
      ) : null}

      {phase === "creating" && createStartedAt ? (
        <div className="mt-8 max-w-xl">
          <CreateProgress label="Deploying a trustless referee to testnet…" startedAt={createStartedAt} />
        </div>
      ) : null}

      {(phase === "active" || phase === "finished") && dto ? (
        <div className="mt-8 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
          <div className="flex flex-col gap-4">
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-3">
                <Hud round={dto.round} humanPlayer={humanPlayer} turnLabel={turnLabel} />
              </div>
              <div className={cn("relative aspect-square bg-bg-panel p-4", !isHumanTurn && "cursor-default")}>
                <TransitMap
                  players={dto.players}
                  humanPlayerId={humanPlayerId}
                  shadow={shadow}
                  legalMoves={isHumanTurn ? dto.currentPlayer?.legalMoves ?? [] : []}
                  revealSpotlight={lastReveal}
                  onSelectNode={handleSelectNode}
                  disabled={!isHumanTurn}
                />
              </div>
              <div className="flex flex-col gap-3 border-t border-border px-5 py-4">
                <MapLegend />
                {busyLabel || proofPhase !== "idle" ? (
                  <ProofStatusCard phase={busyLabel ? "proving" : proofPhase} proofStatus={dto.proofStatus} explorerUrl={explorerUrl} />
                ) : null}
              </div>
            </Card>

            <CantCheatNote explorerUrl={explorerUrl} />

            {phase === "finished" && dto.outcome ? (
              <OutcomePanel outcome={dto.outcome} explorerUrl={explorerUrl} onNewMatch={reset} />
            ) : null}
          </div>

          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Ticket feed</CardTitle>
              </CardHeader>
              <CardContent>
                <TicketFeed
                  ticketFeed={dto.ticketFeed}
                  phantomTickets={extractPhantomTickets(dto.ticketFeed, investigatorCount)}
                  cycleLen={investigatorCount + 1}
                  revealRounds={new Set(DEFAULT_REVEAL_ROUNDS)}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Event log</CardTitle>
              </CardHeader>
              <CardContent className="max-h-80 overflow-y-auto">
                <EventLog log={dto.log} />
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}

      <TicketPickerDialog
        open={pendingPick !== null}
        node={pendingPick?.node ?? null}
        tickets={pendingPick?.tickets ?? []}
        humanPlayer={humanPlayer}
        onPick={(ticket) => pendingPick && void submitMove(pendingPick.node, ticket)}
        onOpenChange={(open) => !open && setPendingPick(null)}
      />
    </div>
  );
}
