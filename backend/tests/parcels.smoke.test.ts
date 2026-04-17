/**
 * parcels.smoke.test.ts
 *
 * Protects F4:
 *  - fetch single parcel returns GeoJSON Feature
 *  - parcels with review_status='review' are NOT excluded (visibility regression guard)
 *  - comment append validates min length
 *  - status update accepts all four valid statuses; rejects invalid
 *
 * All DB calls stubbed. withTransaction uses pool.connect() so we also stub
 * the client returned by connect().
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

vi.mock("pg", () => {
  const mockQuery = vi.fn();
  const mockConnect = vi.fn();
  class Pool {
    query = mockQuery;
    connect = mockConnect;
    end = vi.fn();
  }
  return { Pool, default: { Pool } };
});

import { createApp } from "../src/app.js";
import { pool } from "../src/lib/db.js";

const JWT_SECRET = "test-secret-for-vitest-do-not-use-in-prod";
const app = createApp();

function makeToken(role: "admin" | "client" = "admin", id = 1) {
  return jwt.sign({ id, email: "user@test.com", name: "Tester", role }, JWT_SECRET, {
    expiresIn: "1h",
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function stubQuery(...results: any[]) {
  let spy = vi.spyOn(pool, "query");
  for (const r of results) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    spy = spy.mockResolvedValueOnce(r as any);
  }
  return spy;
}

function stubConnect(clientQueryResults: unknown[]) {
  const mockClient = {
    query: vi.fn(),
    release: vi.fn(),
  };
  let q = mockClient.query;
  for (const r of clientQueryResults) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    q = q.mockResolvedValueOnce(r as any);
  }
  vi.spyOn(pool, "connect").mockResolvedValueOnce(mockClient as never);
  return mockClient;
}

const AUTH_ADMIN = { rows: [{ id: 1, email: "user@test.com", name: "Tester", role: "admin" }] };

const minimalParcelRow = {
  id: 5,
  properties: {
    parcelNumber: "12345",
    ownerName: "Test Owner",
    questionAreaCode: "QA-001",
  },
  geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
  review_status: "review",
};

describe("GET /api/parcels/:id", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 without token", async () => {
    const res = await request(app).get("/api/parcels/5");
    expect(res.status).toBe(401);
  });

  it("returns 400 for non-integer id", async () => {
    stubQuery(AUTH_ADMIN);

    const res = await request(app)
      .get("/api/parcels/abc")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown parcel id", async () => {
    // auth, then getParcelBase returns no rows
    stubQuery(AUTH_ADMIN, { rows: [] });

    const res = await request(app)
      .get("/api/parcels/9999")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(404);
  });

  it("returns a parcel with review_status='review' and does not exclude it", async () => {
    // auth, getParcelBase, comments, documents
    stubQuery(AUTH_ADMIN, { rows: [minimalParcelRow] }, { rows: [] }, { rows: [] });

    const res = await request(app)
      .get("/api/parcels/5")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("type", "Feature");
    expect(res.body.properties).toHaveProperty("reviewStatus", "review");
    expect(Array.isArray(res.body.comments)).toBe(true);
    expect(Array.isArray(res.body.documents)).toBe(true);
  });
});

describe("POST /api/parcels/:id/comments", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 for body shorter than 3 chars", async () => {
    stubQuery(AUTH_ADMIN);

    const res = await request(app)
      .post("/api/parcels/5/comments")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ body: "hi" });

    expect(res.status).toBe(400);
  });

  it("creates a comment and returns 201", async () => {
    // auth, parcel exists, INSERT
    stubQuery(AUTH_ADMIN, { rows: [{ id: 5 }] }, {
      rows: [{ id: 88, body: "This is a comment.", created_at: "2025-01-01T00:00:00Z" }],
    });

    const res = await request(app)
      .post("/api/parcels/5/comments")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ body: "This is a comment." });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("id", 88);
    expect(res.body).toHaveProperty("body", "This is a comment.");
    expect(res.body).toHaveProperty("authorName", "Tester");
  });
});

describe("PATCH /api/parcels/:id/status", () => {
  beforeEach(() => vi.clearAllMocks());

  const validStatuses = ["review", "active", "resolved", "hold"] as const;

  for (const status of validStatuses) {
    it(`accepts status '${status}'`, async () => {
      // pool.query is used for auth only; withTransaction uses pool.connect()
      stubQuery(AUTH_ADMIN);
      stubConnect([
        undefined, // BEGIN
        { rows: [{ review_status: "active" }] }, // SELECT FOR UPDATE
        undefined, // UPDATE parcel_features
        undefined, // INSERT parcel_comments (audit log)
        undefined, // COMMIT
      ]);

      const res = await request(app)
        .patch("/api/parcels/5/status")
        .set("Authorization", `Bearer ${makeToken()}`)
        .send({ status });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("reviewStatus", status);
    });
  }

  it("returns 400 for invalid status value", async () => {
    stubQuery(AUTH_ADMIN);

    const res = await request(app)
      .patch("/api/parcels/5/status")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ status: "unknown" });

    expect(res.status).toBe(400);
  });
});
