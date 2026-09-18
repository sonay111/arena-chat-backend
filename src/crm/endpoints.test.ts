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

// Exact shape confirmed live 2026-09-18 via a real GET /crm/live-matches
// call. Deliberately kept as the FULL real response (all 10 matches, not
// trimmed) since two real quirks only show up across the whole set: status
// casing is inconsistent ("not_started" on the cricket matches vs
// "NotStarted" on the tennis one), and `region` is null for one match.
const REAL_LIVE_MATCHES_RESPONSE = {
  status: true,
  message: "Live matches found",
  data: {
    matches: [
      { matchId: "sr:match:74630144", status: "Live", sportName: "Soccer", team1Name: "Zhejiang Professional Srl", team2Name: "Wuhan Three Towns FC Srl", tournamentName: "China Super League SRL", region: "Simulated Reality League", startTime: "2026-09-18T05:00:00.000Z", updatedAt: "2026-09-18T05:02:09.438Z" },
      { matchId: "sr:match:74791556", status: "Live", sportName: "Table Tennis", team1Name: "Svoboda, Jan", team2Name: "Stolfa, Jakub", tournamentName: "Czech Liga Pro", region: "Czech Republic", startTime: "2026-09-18T06:00:00.000Z", updatedAt: "2026-09-18T06:01:16.837Z" },
      { matchId: "sr:match:74791846", status: "Live", sportName: "Table Tennis", team1Name: "Zika, Tadeas", team2Name: "Wawrosz, Pavel", tournamentName: "Czech Liga Pro", region: "Czech Republic", startTime: "2026-09-18T06:00:00.000Z", updatedAt: "2026-09-18T06:01:16.538Z" },
      { matchId: "sr:match:74793146", status: "Live", sportName: "Table Tennis", team1Name: "Skacelik, Richard", team2Name: "Byrtus, Samuel", tournamentName: "Czech Liga Pro", region: "Czech Republic", startTime: "2026-09-18T06:00:00.000Z", updatedAt: "2026-09-18T06:01:17.010Z" },
      { matchId: "sr:match:74291666", status: "not_started", sportName: "Cricket", team1Name: "India", team2Name: "Australia", tournamentName: "U19 ODI Series India vs Australia", region: "International Youth", startTime: "2026-09-18T03:30:00.000Z", updatedAt: "2026-09-17T19:31:44.070Z" },
      { matchId: "sr:match:73455992", status: "Live", sportName: "Cricket", team1Name: "Western Australia", team2Name: "South Australia Redbacks", tournamentName: "One-Day Cup", region: "Australia", startTime: "2026-09-18T06:00:00.000Z", updatedAt: "2026-09-18T06:01:23.172Z" },
      { matchId: "sr:match:74525010", status: "Suspended", sportName: "Cricket", team1Name: "Japan", team2Name: "India", tournamentName: "T20 Asian Games, Women", region: "International", startTime: "2026-09-18T05:00:00.000Z", updatedAt: "2026-09-18T06:17:49.764Z" },
      { matchId: "sr:match:74621936", status: "not_started", sportName: "Cricket", team1Name: "Mumbai", team2Name: "Kerala", tournamentName: "List-A Oman Tri-Series", region: "International", startTime: "2026-09-18T05:30:00.000Z", updatedAt: "2026-09-17T19:31:44.070Z" },
      { matchId: "sr:match:74805980", status: "NotStarted", sportName: "Tennis", team1Name: "Trismuwantara, Gunawan", team2Name: "Cretu, Cezar (2001)", tournamentName: "Davis Cup", region: null, startTime: "2026-09-18T05:30:00.000Z", updatedAt: "2026-09-18T05:29:12.464Z" },
      { matchId: "sr:match:74791922", status: "Live", sportName: "Table Tennis", team1Name: "Vaclavik, Miroslav", team2Name: "Novotny, Ladislav", tournamentName: "Czech Liga Pro", region: "Czech Republic", startTime: "2026-09-18T06:00:00.000Z", updatedAt: "2026-09-18T06:01:12.345Z" },
    ],
    totalData: 10,
    feed: { "1": true, "3": true, "4": true, "5": true },
  },
};

test("parseLiveMatchesResponse reads matches/totalData/feed from the real data envelope", () => {
  const result = parseLiveMatchesResponse(REAL_LIVE_MATCHES_RESPONSE);
  assert.equal(result.matches.length, 10);
  assert.equal(result.totalData, 10);
  assert.deepEqual(result.feed, { "1": true, "3": true, "4": true, "5": true });
});

test("parseLiveMatchesResponse preserves each match's real fields, including a null region", () => {
  const result = parseLiveMatchesResponse(REAL_LIVE_MATCHES_RESPONSE);
  const suspended = result.matches.find((m) => m.matchId === "sr:match:74525010");
  assert.ok(suspended);
  assert.equal(suspended.status, "Suspended");
  assert.equal(suspended.team1Name, "Japan");

  const noRegion = result.matches.find((m) => m.matchId === "sr:match:74805980");
  assert.equal(noRegion?.region, null);
});
