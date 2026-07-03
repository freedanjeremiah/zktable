import cityMapRaw from "@/lib/map/city.json";
import type { GraphLike } from "./shadow";

type CityMapFile = {
  nodes: number[];
  edges: Array<{ from: number; to: number; ticket: 0 | 1 | 2 }>;
  bidirectional: boolean;
};

const raw = cityMapRaw as unknown as CityMapFile;

/** The real Blackout city graph, browser-safe (plain JSON import, no `node:fs`). */
export const CITY_GRAPH: GraphLike = {
  nodes: raw.nodes,
  edges: raw.edges,
  bidirectional: raw.bidirectional,
};
