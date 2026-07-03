// Route-handler tests (M8.4/M8.5): invoke the App Router handlers directly
// with Request objects — no server, orchestrator mocked. Pins the
// seat-binding 403/200 matrix (the exact hole that briefly broke the
// Freighter flow: prepare must thread the session cookie), the join flow,
// and phantom-move's payload validation.

import { beforeEach, describe, expect, it, vi } from "vitest";

const orchestrator = vi.hoisted(() => ({
  requireMatch: vi.fn(),
  submitHumanMove: vi.fn(),
  prepareHumanMove: vi.fn(),
  submitSignedHumanMove: vi.fn(),
  submitPhantomMove: vi.fn(),
  advanceAiTurns: vi.fn(),
  fetchDto: vi.fn(),
  joinOpenMatch: vi.fn(),
  createBlackoutMatch: vi.fn(),
  completeSignedStart: vi.fn(),
  submitPhantomStart: vi.fn(),
  submitPhantomReveal: vi.fn(),
}));
vi.mock("@/lib/blackout/orchestrator", () => orchestrator);
vi.mock("@/lib/blackout/match-store", () => ({ listOpenMatches: vi.fn(async () => []) }));

import { BlackoutApiError } from "@/lib/blackout/errors";
import { POST as movesPost } from "@/app/api/blackout/matches/[id]/moves/route";
import { POST as preparePost } from "@/app/api/blackout/matches/[id]/moves/prepare/route";
import { POST as joinPost } from "@/app/api/blackout/matches/[id]/join/route";
import { POST as phantomMovePost } from "@/app/api/blackout/matches/[id]/phantom-move/route";

function req(body: unknown, cookie?: string): Request {
  return new Request("http://test.local/api", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie: `zktable_session=${cookie}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

const ctx = { params: Promise.resolve({ id: "m1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  orchestrator.requireMatch.mockResolvedValue({ id: "m1" });
  orchestrator.fetchDto.mockResolvedValue({ matchId: "m1" });
  orchestrator.advanceAiTurns.mockResolvedValue({ movesPlayed: 0 });
});

describe("seat-binding (session token) matrix", () => {
  it("threads the cookie into submitHumanMove and returns 200 for the owner", async () => {
    const res = await movesPost(req({ player: 1, node: 5, ticket: 0 }, "tok-owner"), ctx);
    expect(res.status).toBe(200);
    expect(orchestrator.submitHumanMove).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sessionToken: "tok-owner" }),
    );
  });

  it("surfaces the orchestrator's 403 for a foreign session", async () => {
    orchestrator.submitHumanMove.mockRejectedValue(
      new BlackoutApiError(403, 'seat "investigator1" belongs to a different session'),
    );
    const res = await movesPost(req({ player: 1, node: 5, ticket: 0 }, "tok-other"), ctx);
    expect(res.status).toBe(403);
  });

  it("prepare threads the cookie too (the wallet flow's first step)", async () => {
    orchestrator.prepareHumanMove.mockResolvedValue({ xdr: "XDR" });
    const res = await preparePost(req({ player: 1, node: 5, ticket: 0 }, "tok-owner"), ctx);
    expect(res.status).toBe(200);
    expect(orchestrator.prepareHumanMove).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sessionToken: "tok-owner" }),
    );
  });
});

describe("join", () => {
  it("claims the open seat for this session and returns the seat id", async () => {
    orchestrator.joinOpenMatch.mockResolvedValue("investigator1");
    const res = await joinPost(req({}), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ playerId: "investigator1" });
    // A session cookie is minted for the joiner when none was sent.
    expect(res.headers.get("set-cookie")).toContain("zktable_session=");
  });

  it("maps a full match to the orchestrator's 409", async () => {
    orchestrator.joinOpenMatch.mockRejectedValue(new BlackoutApiError(409, "no open seat to join in this match"));
    const res = await joinPost(req({}), ctx);
    expect(res.status).toBe(409);
  });
});

describe("phantom-move payload validation", () => {
  const goodProof = "ab".repeat(14592);

  it("rejects a malformed proof hex with 400 before touching the chain", async () => {
    const res = await phantomMovePost(req({ cNewHex: "ab".repeat(32), ticket: 0, proofHex: "zzzz" }), ctx);
    expect(res.status).toBe(400);
    expect(orchestrator.submitPhantomMove).not.toHaveBeenCalled();
  });

  it("rejects a truncated proof with 400", async () => {
    const res = await phantomMovePost(
      req({ cNewHex: "ab".repeat(32), ticket: 0, proofHex: "ab".repeat(100) }),
      ctx,
    );
    expect(res.status).toBe(400);
  });

  it("rejects an out-of-range ticket with 400", async () => {
    const res = await phantomMovePost(req({ cNewHex: "ab".repeat(32), ticket: 7, proofHex: goodProof }), ctx);
    expect(res.status).toBe(400);
  });

  it("surfaces the orchestrator's 400 when the Phantom seat is AI-controlled", async () => {
    orchestrator.submitPhantomMove.mockRejectedValue(
      new BlackoutApiError(400, "this match's Phantom is AI-controlled"),
    );
    const res = await phantomMovePost(req({ cNewHex: "ab".repeat(32), ticket: 0, proofHex: goodProof }), ctx);
    expect(res.status).toBe(400);
  });

  it("accepts a well-formed payload and reuses the cached chain state", async () => {
    orchestrator.submitPhantomMove.mockResolvedValue({ round: 1 });
    orchestrator.requireMatch.mockResolvedValue({ id: "m1", config: { revealRounds: [3] } });
    const res = await phantomMovePost(req({ cNewHex: "ab".repeat(32), ticket: 0, proofHex: goodProof }), ctx);
    expect(res.status).toBe(200);
    expect(orchestrator.advanceAiTurns).toHaveBeenCalled(); // round 1 is not a reveal round
  });
});
