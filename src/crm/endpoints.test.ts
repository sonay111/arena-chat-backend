import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGetUsersResponse } from "./endpoints.js";

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
