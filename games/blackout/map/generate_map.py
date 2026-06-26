#!/usr/bin/env python3
"""Deterministic generator for the Blackout city transit map.

Produces a Scotland-Yard-style graph: dense local TAXI links, medium-range BUS
links between arterials, and a sparse RAIL network between a few hubs. Fully
deterministic (fixed layout, no RNG) so the edge-tree root is stable.

Output: city.json  { nodes:[...], bidirectional:true, edges:[{from,to,ticket}] }
Ticket ids: 0=taxi, 1=bus, 2=rail.

Kept under the move_along circuit's 1024 directed-edge capacity (TREE_DEPTH=10).
"""
import json
import os

# A 10x10 lattice of 100 nodes (ids 1..100), positioned on a grid.
COLS, ROWS = 10, 10
N = COLS * ROWS


def nid(c, r):
    return r * COLS + c + 1  # 1-based


def pos(n):
    i = n - 1
    return (i % COLS, i // COLS)


edges = set()  # undirected (min,max,ticket)


def add(a, b, ticket):
    if a == b:
        return
    edges.add((min(a, b), max(a, b), ticket))


# --- TAXI (0): 4-neighbourhood grid + some diagonals for texture ---
for r in range(ROWS):
    for c in range(COLS):
        n = nid(c, r)
        if c + 1 < COLS:
            add(n, nid(c + 1, r), 0)
        if r + 1 < ROWS:
            add(n, nid(c, r + 1), 0)
        # sparse diagonals every other cell for irregularity
        if (c + r) % 2 == 0 and c + 1 < COLS and r + 1 < ROWS:
            add(n, nid(c + 1, r + 1), 0)

# --- BUS (1): arterials along every 3rd row/col, longer hops ---
for r in range(0, ROWS, 3):
    for c in range(COLS - 2):
        add(nid(c, r), nid(c + 2, r), 1)
for c in range(0, COLS, 3):
    for r in range(ROWS - 2):
        add(nid(c, r), nid(c, r + 2), 1)

# --- RAIL (2): a handful of hubs connected as a ring + spokes ---
hubs = [nid(1, 1), nid(8, 1), nid(1, 8), nid(8, 8), nid(4, 4), nid(5, 5)]
for i in range(len(hubs)):
    add(hubs[i], hubs[(i + 1) % len(hubs)], 2)
# spokes from centre hubs
add(nid(4, 4), nid(8, 1), 2)
add(nid(5, 5), nid(1, 8), 2)

edge_list = sorted(edges)
directed = len(edge_list) * 2  # bidirectional
assert directed <= 1024, f"too many directed edges: {directed} > 1024"

city = {
    "name": "Blackout City",
    "nodes": list(range(1, N + 1)),
    "positions": {str(n): list(pos(n)) for n in range(1, N + 1)},
    "bidirectional": True,
    "edges": [{"from": a, "to": b, "ticket": t} for (a, b, t) in edge_list],
    "ticketTypes": {"0": "taxi", "1": "bus", "2": "rail"},
}

out = os.path.join(os.path.dirname(__file__), "city.json")
with open(out, "w") as f:
    json.dump(city, f, indent=2)

by_ticket = {0: 0, 1: 0, 2: 0}
for (_, _, t) in edge_list:
    by_ticket[t] += 1
print(f"nodes={N} undirected_edges={len(edge_list)} directed={directed}")
print(f"taxi={by_ticket[0]} bus={by_ticket[1]} rail={by_ticket[2]}")
print(f"wrote {out}")
