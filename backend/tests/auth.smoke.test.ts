/**
 * auth.smoke.test.ts
 *
 * Verifies login endpoint shape + status codes WITHOUT a real database.
 * The pg Pool is mocked at module boundary so no network connection is attempted.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

// Must be declared before any src import so vitest hoists it
vi.mock("pg", () => {
  const mockQuery = vi.fn();
  class Pool {
    query = mockQuery;
    connect = vi.fn();
    end = vi.fn();
  }
  return { Pool, default: { Pool } };
});

import { createApp } from "../src/app.js";
import { pool } from "../src/lib/db.js";

const JWT_SECRET = "test-secret-for-vitest-do-not-use-in-prod";
const app = createApp();

function mockQuery() {
  return vi.spyOn(pool, "query");
}

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for missing body fields", async () => {
    const res = await request(app).post("/api/auth/login").send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("message");
  });

  it("returns 400 for invalid email format", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "not-an-email", password: "secret" });
    expect(res.status).toBe(400);
  });

  it("returns 401 when user is not found in DB", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockQuery().mockResolvedValueOnce({ rows: [] } as any);

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@example.com", password: "password123" });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("message", "Invalid credentials.");
  });

  it("returns 401 when password is wrong", async () => {
    mockQuery().mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          name: "Test User",
          email: "user@example.com",
          // bcrypt hash of "correct-password"; it will not match "wrong-password".
          password_hash: "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy",
          role: "admin",
        },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "user@example.com", password: "wrong-password" });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("message", "Invalid credentials.");
  });

  it("returns 200 with token + user shape on valid credentials", async () => {
    const bcrypt = await import("bcryptjs");
    const hash = await bcrypt.hash("correct-password", 10);

    mockQuery().mockResolvedValueOnce({
      rows: [
        {
          id: 42,
          name: "Admin User",
          email: "admin@example.com",
          password_hash: hash,
          role: "admin",
        },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "admin@example.com", password: "correct-password" });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("token");
    expect(typeof res.body.token).toBe("string");
    expect(res.body).toHaveProperty("user");
    expect(res.body.user).toMatchObject({
      id: 42,
      email: "admin@example.com",
      name: "Admin User",
      role: "admin",
    });
    // password_hash must NOT be exposed
    expect(res.body.user).not.toHaveProperty("password_hash");
  });
});

describe("GET /api/auth/me", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 with no token", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("returns 401 with invalid token", async () => {
    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", "Bearer totally-invalid-token");
    expect(res.status).toBe(401);
  });

  it("returns the database-loaded role instead of a stale token role", async () => {
    const token = jwt.sign(
      { id: 7, email: "user@example.com", name: "Old User", role: "client" },
      JWT_SECRET,
      { expiresIn: "1h" },
    );
    mockQuery().mockResolvedValueOnce({
      rows: [
        {
          id: 7,
          name: "Current User",
          email: "user@example.com",
          role: "gis_team",
        },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      id: 7,
      email: "user@example.com",
      name: "Current User",
      role: "gis_team",
    });
  });
});
