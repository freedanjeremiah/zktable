"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  confirmPhantomMove,
  discardPendingPhantomMove,
  loadPhantomSecret,
  phantomLegalMoves,
  phantomRevealPayload,
  preparePhantomStart,
  provePhantomMove,
} from "@/lib/phantom/phantom-client";
import { signTransactionXdr } from "@/lib/wallet/freighter-adapter";
import { useWallet } from "@/lib/wallet/wallet-context";
import { cn } from "@/lib/utils";

type Phase = "setup" | "creating" | "active" | "finished";

type PendingPick = { node: number; tickets: Ticket[] };

type OpenMatchSummary = { id: string; createdAt: number; refereeId: string; openSeats: string[]; status: string };

async function readJson<T>(res: Response): Promise<T> {
  const json = (await res.json()) as T | { error: string };
  if (!res.ok) {
    const message = json && typeof json === "object" && "error" in json ? json.error : `request failed (${res.status})`;
    throw new Error(message);
  }
  return json as T;
}

export default function BlackoutBoardPage() {
  const wallet = useWallet();
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
  const [openMatches, setOpenMatches] = useState<OpenMatchSummary[]>([]);
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
    window.history.replaceState(null, "", "/play/blackout");
  }, []);

  // Resume a match from the URL (M8.4): /play/blackout?match=<id> — a page
  // reload (or a second browser) picks the match back up from the durable
  // store instead of orphaning it.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("match");
    if (!id) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/blackout/matches/${id}`);
        const state = await readJson<MatchDto>(res);
        if (cancelled) return;
        setMatchId(id);
        setExplorerUrl(state.explorerUrl);
        setDto(state);
        const human =
          state.phantomHuman && loadPhantomSecret(id)
            ? state.players.find((p) => p.role === "phantom")
            : state.players.find((p) => p.role === "investigator" && !p.isAi);
        setHumanPlayerId(human?.id ?? null);
        setPhase(state.status === "finished" ? "finished" : "active");
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The open-match lobby (M8.4): visible while picking a game to start.
  useEffect(() => {
    if (phase !== "setup") return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/blackout/matches");
        const json = await readJson<{ matches: OpenMatchSummary[] }>(res);
        if (!cancelled) setOpenMatches(json.matches);
      } catch {
        // The lobby list is best-effort; creating a match works regardless.
      }
    };
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 8000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [phase]);

  const joinOpenMatch = useCallback(async (id: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/blackout/matches/${id}/join`, { method: "POST" });
      const json = await readJson<{ playerId: string; state: MatchDto }>(res);
      setMatchId(id);
      setExplorerUrl(json.state.explorerUrl);
      setDto(json.state);
      setHumanPlayerId(json.playerId);
      setPhase(json.state.status === "finished" ? "finished" : "active");
      window.history.replaceState(null, "", `/play/blackout?match=${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Light polling while someone else (AI or another browser) is on the
  // clock, so this view keeps up without a manual refresh.
  useEffect(() => {
    if (phase !== "active" || !matchId || busyLabel) return;
    if (dto?.currentPlayer && !dto.currentPlayer.isAi && dto.currentPlayer.id === humanPlayerId) return;
    const timer = setInterval(() => {
      // Backgrounded tabs must not hammer the server (each poll is a chain
      // read); the next visible tick catches up.
      if (document.visibilityState !== "visible") return;
      void (async () => {
        try {
          const res = await fetch(`/api/blackout/matches/${matchId}`);
          const state = await readJson<MatchDto>(res);
          setDto(state);
          if (state.status === "finished") setPhase("finished");
        } catch {
          // Transient poll failures are fine — the next tick retries.
        }
      })();
    }, 4000);
    return () => clearInterval(timer);
  }, [phase, matchId, busyLabel, dto, humanPlayerId]);

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
        const playPhantom = options.seat === "phantom";
        const walletAddress = !playPhantom && wallet.status === "connected" ? wallet.address : undefined;
        const res = await fetch("/api/blackout/matches", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            investigators: options.investigators,
            aiInvestigators: playPhantom ? options.investigators : undefined,
            model: options.model || undefined,
            walletAddress: walletAddress ?? undefined,
            phantomSeat: playPhantom ? "human" : undefined,
            open: options.open || undefined,
          }),
        });
        const json = await readJson<{ matchId: string; explorerUrl: string; state: MatchDto }>(res);
        setMatchId(json.matchId);
        setExplorerUrl(json.explorerUrl);
        setDto(json.state);
        window.history.replaceState(null, "", `/play/blackout?match=${json.matchId}`);
        const human = playPhantom
          ? json.state.players.find((p) => p.role === "phantom")
          : json.state.players.find((p) => p.role === "investigator" && !p.isAi);
        setHumanPlayerId(human?.id ?? null);

        // Human Phantom (M8.5): generate the secret start IN THIS BROWSER,
        // send only its commitment, and the match starts with you on the
        // clock — no AI pre-roll.
        if (playPhantom && json.state.pendingPhantomStart) {
          setBusyLabel("Committing your hidden start (secret stays in this browser)…");
          const { commitmentHex } = await preparePhantomStart(json.matchId);
          const startRes = await fetch(`/api/blackout/matches/${json.matchId}/phantom-start`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ commitmentHex }),
          });
          const started = await readJson<MatchDto>(startRes);
          setDto(started);
          setBusyLabel(null);
          setPhase("active");
          return;
        }

        // Wallet-bound seat: the referee demands the wallet's signature on
        // its own set_public_start before the match can start.
        let state = json.state;
        if (state.pendingStart) {
          setBusyLabel("Sign your starting position in Freighter…");
          const signedXdr = await signTransactionXdr(state.pendingStart.xdr, {
            address: walletAddress ?? undefined,
          });
          const startRes = await fetch(`/api/blackout/matches/${json.matchId}/start-signed`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ signedXdr }),
          });
          state = await readJson<MatchDto>(startRes);
          setDto(state);
          setBusyLabel(null);
        }

        setPhase("active");
        // The Phantom always opens — advance it immediately so the board
        // never sits idle waiting on an AI seat.
        await runAiTurns(json.matchId);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPhase("setup");
      }
    },
    [runAiTurns, wallet.status, wallet.address],
  );

  const submitMove = useCallback(
    async (node: number, ticket: Ticket) => {
      if (!matchId || !dto?.currentPlayer) return;
      setError(null);
      setPendingPick(null);
      setBusyLabel("Submitting your move…");
      try {
        const player = dto.currentPlayer.index;
        let res: Response;
        if (dto.phantomHuman && dto.currentPlayer.role === "phantom") {
          // Prove the hidden move IN THE BROWSER (M8.5): the position and
          // salts never leave this machine — only {c_new, ticket, proof}.
          const preRound = dto.round;
          setBusyLabel("Proving your move in this browser — typically 10–30 s…");
          const payload = await provePhantomMove(matchId, { to: node, ticket });
          setBusyLabel("Submitting your proof on-chain…");
          let next: MatchDto;
          try {
            res = await fetch(`/api/blackout/matches/${matchId}/phantom-move`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(payload),
            });
            next = await readJson<MatchDto>(res);
          } catch (err) {
            // The move never landed: drop the staged (pos, salt) so the
            // CURRENT salt (matching the on-chain commitment) stays
            // authoritative for the retry.
            discardPendingPhantomMove(matchId);
            throw err;
          }
          // Landed on-chain — promote the staged secret.
          confirmPhantomMove(matchId);
          const revealRounds = next.revealRounds.length > 0 ? next.revealRounds : DEFAULT_REVEAL_ROUNDS;
          if (revealRounds.includes(preRound)) {
            setBusyLabel("Reveal round — publishing your position…");
            const revealRes = await fetch(`/api/blackout/matches/${matchId}/phantom-reveal`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(phantomRevealPayload(matchId)),
            });
            next = await readJson<MatchDto>(revealRes);
          }
          setDto(next);
          setProofPhase(next.proofStatus?.ok === false ? "error" : "verified");
          setBusyLabel(null);
          if (next.status === "finished") {
            setPhase("finished");
            return;
          }
          // Same client-side safety net the other paths get: if the server
          // stopped mid-AI-run, kick it (safe — the server holds AI turns
          // while a reveal is still pending).
          if (next.currentPlayer?.isAi) {
            await runAiTurns(matchId);
          }
          return;
        }
        if (dto.walletSeat && dto.walletSeat.player === player) {
          // Wallet-bound seat: prepare -> Freighter sign -> submit. The
          // referee's require_auth() rejects anything the wallet didn't sign.
          const prepRes = await fetch(`/api/blackout/matches/${matchId}/moves/prepare`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ player, node, ticket }),
          });
          const { xdr } = await readJson<{ xdr: string }>(prepRes);
          setBusyLabel("Sign your move in Freighter…");
          const signedXdr = await signTransactionXdr(xdr, { address: dto.walletSeat.address });
          setBusyLabel("Submitting your signed move…");
          res = await fetch(`/api/blackout/matches/${matchId}/moves/submit`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ player, node, ticket, signedXdr }),
          });
        } else {
          res = await fetch(`/api/blackout/matches/${matchId}/moves`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ player, node, ticket }),
          });
        }
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

  // Human Phantom (M8.5): this browser's own secret drives the map — the
  // position marker and legal moves exist ONLY client-side.
  const phantomSecretPos = useMemo(() => {
    if (!dto?.phantomHuman || humanPlayerId !== "phantom" || !matchId) return null;
    return loadPhantomSecret(matchId)?.pos ?? null;
  }, [dto, humanPlayerId, matchId]);

  const displayPlayers = useMemo(() => {
    if (!dto) return [];
    if (phantomSecretPos === null) return dto.players;
    return dto.players.map((p) => (p.role === "phantom" ? { ...p, node: phantomSecretPos } : p));
  }, [dto, phantomSecretPos]);

  const mapLegalMoves = useMemo(() => {
    if (!dto?.currentPlayer) return [];
    if (dto.phantomHuman && dto.currentPlayer.role === "phantom" && humanPlayerId === "phantom") {
      if (phantomSecretPos === null) return [];
      const phantom = dto.players.find((p) => p.role === "phantom");
      return phantomLegalMoves(phantomSecretPos, phantom?.tickets ?? { taxi: 0, bus: 0, rail: 0 }).map((m) => ({
        type: "move",
        to: m.to,
        ticket: m.ticket,
      }));
    }
    return dto.currentPlayer.legalMoves ?? [];
  }, [dto, humanPlayerId, phantomSecretPos]);
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
        <div className="mt-8 flex max-w-xl flex-col gap-6">
          <SetupPanel onStart={handleStart} />
          {openMatches.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Open matches</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {openMatches.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-border px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-mono text-xs text-fg">{m.id}</div>
                      <div className="text-xs text-fg-subtle">
                        seat{m.openSeats.length === 1 ? "" : "s"} {m.openSeats.join(", ")} · {m.status}
                      </div>
                    </div>
                    <Badge
                      variant="accent"
                      className="cursor-pointer select-none"
                      onClick={() => void joinOpenMatch(m.id)}
                    >
                      Join
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
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
                  players={displayPlayers}
                  humanPlayerId={humanPlayerId}
                  shadow={shadow}
                  legalMoves={isHumanTurn ? mapLegalMoves : []}
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
