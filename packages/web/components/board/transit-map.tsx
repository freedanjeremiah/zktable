"use client";

import { useEffect, useRef, useState } from "react";
import cityMapRaw from "@/lib/map/city.json";
import { TICKET_COLOR_VAR, TICKET_EDGE_OPACITY, ticketLabel } from "@/lib/board/ticket-meta";
import type { Ticket } from "@/lib/board/ticket-meta";
import type { MatchDtoPlayer } from "@/lib/blackout/dto";
import type { Move } from "@zktable/core";
import { cn } from "@/lib/utils";

type CityMapData = {
  nodes: number[];
  positions: Record<string, [number, number]>;
  edges: { from: number; to: number; ticket: number }[];
};

const CITY_MAP = cityMapRaw as unknown as CityMapData;

const INVESTIGATOR_PALETTE = [
  "var(--color-accent)",
  "oklch(70% 0.09 200)",
  "oklch(72% 0.11 320)",
  "oklch(74% 0.12 140)",
  "oklch(70% 0.13 30)",
];

export type RevealSpotlight = { node: number; round: number };

export interface TransitMapProps {
  players: MatchDtoPlayer[];
  humanPlayerId: string | null;
  /** Candidate nodes the Phantom could occupy right now — from `computeShadow`. */
  shadow: Set<number>;
  /** Present only when it's the human's turn. */
  legalMoves: Move[];
  /** Most recent reveal, used to trigger the spotlight flash. */
  revealSpotlight: RevealSpotlight | null;
  onSelectNode: (node: number, availableTickets: Ticket[]) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * The Blackout city — an SVG render of the 100-node transit graph. Renders
 * edges by ticket type, investigator pawns, the "possible Phantom
 * locations" fog (from `computeShadow`), legal move targets for the human's
 * turn, and a spotlight flash at reveal rounds. The Phantom itself is NEVER
 * drawn from `players[].node` (always null on-chain) — only from
 * `revealSpotlight`, which comes from `revealLog`.
 */
export function TransitMap({
  players,
  humanPlayerId,
  shadow,
  legalMoves,
  revealSpotlight,
  onSelectNode,
  disabled,
  className,
}: TransitMapProps) {
  const xs = Object.values(CITY_MAP.positions).map((p) => p[0]);
  const ys = Object.values(CITY_MAP.positions).map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = 0.7;
  const viewBox = `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`;

  const legalByNode = new Map<number, Ticket[]>();
  for (const move of legalMoves) {
    const to = move.to as number;
    const ticket = move.ticket as Ticket;
    const list = legalByNode.get(to);
    if (list) list.push(ticket);
    else legalByNode.set(to, [ticket]);
  }

  // Flash the reveal spotlight for a few seconds, then let it settle into a
  // dim "last known" ghost marker until the next reveal replaces it.
  const [flashing, setFlashing] = useState(false);
  const lastRoundRef = useRef<number | null>(null);
  useEffect(() => {
    if (!revealSpotlight) return;
    if (lastRoundRef.current === revealSpotlight.round) return;
    lastRoundRef.current = revealSpotlight.round;
    setFlashing(true);
    const t = setTimeout(() => setFlashing(false), 2600);
    return () => clearTimeout(t);
  }, [revealSpotlight]);

  const investigatorColor = (playerIndex: number, id: string): string => {
    const investigators = players.filter((p) => p.role === "investigator");
    const i = investigators.findIndex((p) => p.id === id);
    return INVESTIGATOR_PALETTE[i % INVESTIGATOR_PALETTE.length] ?? "var(--color-accent)";
  };

  return (
    <div className={cn("relative", className)}>
      <svg
        viewBox={viewBox}
        className="h-full w-full"
        role="img"
        aria-label="Blackout transit map: the city graph with investigator pawns and the Phantom's possible locations"
      >
        {/* Edges. */}
        <g strokeLinecap="round">
          {CITY_MAP.edges.map((edge, i) => {
            const a = CITY_MAP.positions[String(edge.from)];
            const b = CITY_MAP.positions[String(edge.to)];
            if (!a || !b) return null;
            const ticket = edge.ticket as Ticket;
            return (
              <line
                key={i}
                x1={a[0]}
                y1={a[1]}
                x2={b[0]}
                y2={b[1]}
                stroke={TICKET_COLOR_VAR[ticket]}
                strokeOpacity={TICKET_EDGE_OPACITY[ticket]}
                strokeWidth={ticket === 2 ? 0.045 : 0.03}
              />
            );
          })}
        </g>

        {/* Fog: candidate nodes for the Phantom's real position. Drawn ON
            TOP of the edges (so it isn't lost under the line grid) but
            BELOW the node/pawn layer, as a soft wash + a defined core so
            it reads as "cloud over these stations" rather than noise. */}
        <g aria-hidden>
          {[...shadow].map((n) => {
            const p = CITY_MAP.positions[String(n)];
            if (!p) return null;
            return (
              <g key={`fog-${n}`}>
                <circle cx={p[0]} cy={p[1]} r={0.34} fill="var(--color-hidden)" fillOpacity={0.22} />
                <circle cx={p[0]} cy={p[1]} r={0.16} fill="var(--color-hidden)" fillOpacity={0.4} />
              </g>
            );
          })}
        </g>

        {/* Base nodes. */}
        <g>
          {CITY_MAP.nodes.map((n) => {
            const p = CITY_MAP.positions[String(n)];
            if (!p) return null;
            return (
              <circle
                key={n}
                cx={p[0]}
                cy={p[1]}
                r={0.055}
                fill="var(--color-fg-subtle)"
                fillOpacity={0.55}
              />
            );
          })}
        </g>

        {/* Legal move targets (human's turn only). */}
        <g>
          {[...legalByNode.entries()].map(([node, tickets]) => {
            const p = CITY_MAP.positions[String(node)];
            if (!p) return null;
            return (
              <g key={`legal-${node}`}>
                <circle
                  data-testid={`legal-node-${node}`}
                  cx={p[0]}
                  cy={p[1]}
                  r={0.32}
                  fill="transparent"
                  className={disabled ? "" : "cursor-pointer"}
                  onClick={() => !disabled && onSelectNode(node, tickets)}
                >
                  <title>
                    Move to node {node} ({tickets.map(ticketLabel).join(" / ")})
                  </title>
                </circle>
                <circle
                  cx={p[0]}
                  cy={p[1]}
                  r={0.14}
                  fill="none"
                  stroke="var(--color-accent)"
                  strokeWidth={0.028}
                  className={cn(
                    "pointer-events-none motion-safe:animate-pulse-slow",
                    disabled && "opacity-40",
                  )}
                />
              </g>
            );
          })}
        </g>

        {/* Investigator pawns. */}
        <g>
          {players
            .filter((p) => p.role === "investigator" && p.node !== null)
            .map((p) => {
              const pos = CITY_MAP.positions[String(p.node)];
              if (!pos) return null;
              const color = investigatorColor(p.index, p.id);
              const isHuman = p.id === humanPlayerId;
              return (
                <g key={p.id}>
                  {isHuman ? (
                    <circle
                      cx={pos[0]}
                      cy={pos[1]}
                      r={0.2}
                      fill="none"
                      stroke={color}
                      strokeWidth={0.03}
                      strokeOpacity={0.6}
                    />
                  ) : null}
                  <circle cx={pos[0]} cy={pos[1]} r={0.12} fill={color} stroke="var(--color-bg)" strokeWidth={0.025} />
                  <title>
                    {isHuman ? "You" : p.isAi ? "AI Investigator" : "Investigator"} — node {p.node}
                  </title>
                </g>
              );
            })}
        </g>

        {/* Reveal spotlight — the Phantom's node ONLY at a reveal round. */}
        {revealSpotlight ? (
          (() => {
            const p = CITY_MAP.positions[String(revealSpotlight.node)];
            if (!p) return null;
            return (
              <g>
                {flashing ? (
                  <circle
                    cx={p[0]}
                    cy={p[1]}
                    r={0.6}
                    fill="var(--color-danger)"
                    fillOpacity={0.22}
                    className="motion-safe:animate-pulse-slow"
                  />
                ) : null}
                <circle
                  cx={p[0]}
                  cy={p[1]}
                  r={0.16}
                  fill="var(--color-danger)"
                  fillOpacity={flashing ? 0.95 : 0.55}
                />
                <circle cx={p[0]} cy={p[1]} r={0.16} fill="none" stroke="var(--color-bg)" strokeWidth={0.02} />
                <title>Phantom revealed at node {revealSpotlight.node} (round {revealSpotlight.round})</title>
              </g>
            );
          })()
        ) : null}
      </svg>
    </div>
  );
}
