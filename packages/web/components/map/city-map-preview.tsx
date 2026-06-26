import cityMap from "@/lib/map/city.json";
import { cn } from "@/lib/utils";

/**
 * A static, non-interactive teaser render of the real Blackout city map
 * (`games/blackout/map/city.json` — 100 nodes, 293 edges, three transport
 * types). Not the game board; just enough to make the lobby card feel like
 * a real place instead of an icon. Colored by transport type: taxi in the
 * "verified" brass, bus/rail in cooler neutrals. One node pulses to hint at
 * a hidden piece moving through the graph — purely decorative here.
 */

type TicketId = 0 | 1 | 2;

const TICKET_STROKE: Record<TicketId, string> = {
  0: "var(--color-accent)", // taxi
  1: "var(--color-fg-subtle)", // bus
  2: "var(--color-hidden)", // rail
};

const TICKET_OPACITY: Record<TicketId, number> = {
  0: 0.55,
  1: 0.25,
  2: 0.4,
};

interface CityMapData {
  nodes: number[];
  positions: Record<string, [number, number]>;
  edges: { from: number; to: number; ticket: number }[];
}

const map = cityMap as unknown as CityMapData;

// A fixed "phantom" node for the decorative pulse — deterministic, not random,
// so server and client render identically.
const PHANTOM_NODE = "54";

export function CityMapPreview({ className }: { className?: string }) {
  const xs = Object.values(map.positions).map((p) => p[0]);
  const ys = Object.values(map.positions).map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = 0.6;
  const viewBox = `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`;

  const phantomPos = map.positions[PHANTOM_NODE];

  return (
    <svg
      viewBox={viewBox}
      className={cn("h-full w-full", className)}
      role="img"
      aria-label="Preview of the Blackout transit map: a grid of stations connected by taxi, bus, and rail lines"
    >
      <g strokeLinecap="round">
        {map.edges.map((edge, i) => {
          const a = map.positions[String(edge.from)];
          const b = map.positions[String(edge.to)];
          if (!a || !b) return null;
          const ticket = edge.ticket as TicketId;
          return (
            <line
              key={i}
              x1={a[0]}
              y1={a[1]}
              x2={b[0]}
              y2={b[1]}
              stroke={TICKET_STROKE[ticket]}
              strokeOpacity={TICKET_OPACITY[ticket]}
              strokeWidth={ticket === 2 ? 0.05 : 0.035}
            />
          );
        })}
      </g>
      <g>
        {map.nodes.map((n) => {
          const p = map.positions[String(n)];
          if (!p) return null;
          return (
            <circle
              key={n}
              cx={p[0]}
              cy={p[1]}
              r={0.06}
              fill="var(--color-fg-subtle)"
              fillOpacity={0.5}
            />
          );
        })}
      </g>
      {phantomPos ? (
        <g>
          <circle
            cx={phantomPos[0]}
            cy={phantomPos[1]}
            r={0.22}
            fill="var(--color-hidden)"
            fillOpacity={0.25}
            className="motion-safe:animate-pulse-slow"
          />
          <circle
            cx={phantomPos[0]}
            cy={phantomPos[1]}
            r={0.09}
            fill="var(--color-hidden-strong)"
          />
        </g>
      ) : null}
    </svg>
  );
}
