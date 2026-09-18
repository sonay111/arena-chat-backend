import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGetUsersResponse, parseLiveMatchesResponse } from "./endpoints.js";

// No mocking library exists in this project, and no other CRM test
// exercises a live network call — parseGetUsersResponse is a pure
// function specifically so this can test the real envelope shape
// directly, without either.

// Exact shape confirmed 2026-09-10 against real adminapiqa traffic, after
// Satyam's API update — a single-user lookup via ?userId=...
const REAL_SINGLE_USER_RESPONSE = {
  status: true,
  message: "User found",
  data: {
    users: [
      {
        _id: "6a957422c7174d088c1eec2a",
        username: "user_52ks5715",
        phone: "9466480296",
        countryCode: "91",
        is_blocked: false,
        createdAt: "2026-08-31T12:31:30.138Z",
      },
    ],
    totalPage: 1,
    currentPage: 1,
    totalData: 1,
  },
};

// Exact shape confirmed the same day for an unfiltered/paginated call —
// same envelope, multiple users, some with an email field and some
// without (real traffic showed both).
const REAL_MULTI_USER_RESPONSE = {
  status: true,
  message: "User found",
  data: {
    users: [
      {
        _id: "69fc2cb5e2db8b21c548173b",
        username: "user_uo9cu807",
        phone: "585308936",
        countryCode: "971",
        is_blocked: false,
        createdAt: "2026-05-07T06:09:57.326Z",
      },
      {
        _id: "6a05fb268a945e5e96002136",
        username: "user_64t75n9n",
        phone: "8930850291",
        countryCode: "374",
        is_blocked: false,
        createdAt: "2026-05-14T16:41:10.878Z",
        email: "tech3@vikara.uk",
      },
    ],
    totalPage: 1,
    currentPage: 1,
    totalData: 2,
  },
};

test("parseGetUsersResponse reads users from the real data.users envelope, not a flat array", () => {
  const result = parseGetUsersResponse(REAL_SINGLE_USER_RESPONSE);
  assert.equal(result.users.length, 1);
  assert.equal(result.users[0]._id, "6a957422c7174d088c1eec2a");
  assert.equal(result.users[0].countryCode, "91");
});

test("parseGetUsersResponse maps pagination the same way as every other section API", () => {
  const result = parseGetUsersResponse(REAL_SINGLE_USER_RESPONSE);
  assert.deepEqual(result.pagination, { page: 1, totalPages: 1, totalRows: 1 });
});

test("parseGetUsersResponse handles multiple users, including one with no email", () => {
  const result = parseGetUsersResponse(REAL_MULTI_USER_RESPONSE);
  assert.equal(result.users.length, 2);
  assert.equal(result.users[0].email, undefined);
  assert.equal(result.users[1].email, "tech3@vikara.uk");
  assert.equal(result.users[0].countryCode, "971");
  assert.equal(result.users[1].countryCode, "374");
  assert.deepEqual(result.pagination, { page: 1, totalPages: 1, totalRows: 2 });
});

// Exact shape confirmed live 2026-09-18, AFTER Satyam's same-day update to
// this endpoint. Superseded the shape below it (kept in git history) --
// three real fields didn't exist before this update: sportId (the real
// sr:sport:N code, no longer reverse-derived from sportName), producerId/
// connection (genuinely per-match now -- the previous response's
// top-level `feed` object is gone entirely, not present anywhere in this
// shape), and hasOdds (false correlates with producerId/connection both
// null, confirmed on one real example).
const REAL_LIVE_MATCHES_RESPONSE = {
  status: true,
  message: "Live matches found",
  data: {
    matches: [
      { matchId: "sr:match:74720562", sportId: "sr:sport:1", status: "Interrupted", sportName: "Soccer", team1Name: "Enugu Rangers International FC", team2Name: "Nasarawa United", tournamentName: "Premier League", region: "Nigeria", startTime: "2026-09-17T15:00:00.000Z", updatedAt: "2026-09-18T07:02:51.888Z", producerId: 1, connection: true, hasOdds: true },
      { matchId: "sr:match:74291666", sportId: "sr:sport:21", status: "not_started", sportName: "Cricket", team1Name: "India", team2Name: "Australia", tournamentName: "U19 ODI Series India vs Australia", region: "International Youth", startTime: "2026-09-18T03:30:00.000Z", updatedAt: "2026-09-17T19:31:44.070Z", producerId: 5, connection: true, hasOdds: true },
      { matchId: "sr:match:74805980", sportId: "sr:sport:5", status: "Live", sportName: "Tennis", team1Name: "Trismuwantara, Gunawan", team2Name: "Cretu, Cezar (2001)", tournamentName: "Davis Cup", region: null, startTime: "2026-09-18T05:30:00.000Z", updatedAt: "2026-09-18T07:18:21.592Z", producerId: 1, connection: true, hasOdds: true },
      { matchId: "sr:match:74805984", sportId: "sr:sport:5", status: "NotStarted", sportName: "Tennis", team1Name: "Ali Da Costa, Rafalentino", team2Name: "Papoe, Radu Mihai", tournamentName: "Davis Cup", region: null, startTime: "2026-09-18T06:40:00.000Z", updatedAt: "2026-09-17T22:44:43.453Z", producerId: null, connection: null, hasOdds: false },
      { matchId: "sr:match:74630122", sportId: "sr:sport:1", status: "Live", sportName: "Soccer", team1Name: "Kasimpasa SRL", team2Name: "Konyaspor KIF SRL", tournamentName: "Turkey Super Lig SRL", region: "Simulated Reality League", startTime: "2026-09-18T07:00:00.000Z", updatedAt: "2026-09-18T07:01:46.035Z", producerId: 1, connection: true, hasOdds: true },
    ],
    totalData: 5,
  },
};

test("parseLiveMatchesResponse reads matches/totalData from the real data envelope (no more top-level feed)", () => {
  const result = parseLiveMatchesResponse(REAL_LIVE_MATCHES_RESPONSE);
  assert.equal(result.matches.length, 5);
  assert.equal(result.totalData, 5);
  assert.equal((result as any).feed, undefined, "the old top-level feed object no longer exists in this shape");
});

test("parseLiveMatchesResponse preserves each match's real fields, including a null region and null producerId/connection", () => {
  const result = parseLiveMatchesResponse(REAL_LIVE_MATCHES_RESPONSE);

  const interrupted = result.matches.find((m) => m.matchId === "sr:match:74720562");
  assert.ok(interrupted);
  assert.equal(interrupted.status, "Interrupted", "a real status value not yet in our canonical set");
  assert.equal(interrupted.sportId, "sr:sport:1");

  const noRegion = result.matches.find((m) => m.matchId === "sr:match:74805980");
  assert.equal(noRegion?.region, null);

  const noOdds = result.matches.find((m) => m.matchId === "sr:match:74805984");
  assert.ok(noOdds);
  assert.equal(noOdds.hasOdds, false);
  assert.equal(noOdds.producerId, null);
  assert.equal(noOdds.connection, null);
});
