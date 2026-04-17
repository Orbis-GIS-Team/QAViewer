/**
 * admin-users.smoke.test.ts
 *
 * Protects the F3 fix:
 *  - admin list users response includes commentCount, documentCount, parcelCommentCount
 *  - DELETE a user with parcel_comments returns 409
 *
 * All DB calls stubbed via vi.spyOn(pool, "query"). No real DB needed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

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

function adminToken(id = 1) {
  return jwt.sign({ id, email: "admin@test.com", name: "Admin", role: "admin" }, JWT_SECRET, {
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

// Each authenticated request first loads the current user, then the route handler`r`n// makes its own queries.
const AUTH_ADMIN = {
  rows: [{ id: 1, email: "admin@test.com", name: "Admin", role: "admin" }],
};
const AUTH_CLIENT = {
  rows: [{ id: 2, email: "client@test.com", name: "Client", role: "client" }],
};

describe("GET /api/admin/users", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 without token", async () => {
    const res = await request(app).get("/api/admin/users");
    expect(res.status).toBe(401);
  });

  it("returns 403 for client-role token", async () => {
    stubQuery(AUTH_CLIENT);
    const clientToken = jwt.sign(
      { id: 2, email: "client@test.com", name: "Client", role: "client" },
      JWT_SECRET,
      { expiresIn: "1h" },
    );
    const res = await request(app)
      .get("/api/admin/users")
      .set("Authorization", `Bearer ${clientToken}`);
    expect(res.status).toBe(403);
  });

  it("returns 200 with all three activity count fields", async () => {
    stubQuery(AUTH_ADMIN, {
      rows: [
        {
          id: 1,
          name: "Admin",
          email: "admin@test.com",
          role: "admin",
          created_at: "2025-01-01T00:00:00Z",
          comment_count: 5,
          document_count: 3,
          parcel_comment_count: 2,
        },
      ],
    });

    const res = await request(app)
      .get("/api/admin/users")
      .set("Authorization", `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("users");
    const user = res.body.users[0];
    expect(user).toHaveProperty("commentCount", 5);
    expect(user).toHaveProperty("documentCount", 3);
    expect(user).toHaveProperty("parcelCommentCount", 2);
  });
});

describe("DELETE /api/admin/users/:id (F3 regression guard)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 409 when the user has parcel_comments", async () => {
    stubQuery(AUTH_ADMIN, {
      rows: [
        {
          id: 99,
          name: "To Delete",
          email: "todel@test.com",
          role: "client",
          created_at: "2025-01-01T00:00:00Z",
          comment_count: 0,
          document_count: 0,
          parcel_comment_count: 1, // key: must trigger 409
        },
      ],
    });

    const res = await request(app)
      .delete("/api/admin/users/99")
      .set("Authorization", `Bearer ${adminToken()}`);

    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty("message");
  });

  it("returns 409 when the user has qa comments", async () => {
    stubQuery(AUTH_ADMIN, {
      rows: [
        {
          id: 98,
          name: "Another",
          email: "other@test.com",
          role: "client",
          created_at: "2025-01-01T00:00:00Z",
          comment_count: 3, // qa comments
          document_count: 0,
          parcel_comment_count: 0,
        },
      ],
    });

    const res = await request(app)
      .delete("/api/admin/users/98")
      .set("Authorization", `Bearer ${adminToken()}`);

    expect(res.status).toBe(409);
  });

  it("returns 400 when admin tries to delete their own account", async () => {
    // No route DB call needed; self-delete check happens before getManagedUser.
    stubQuery(AUTH_ADMIN);

    const res = await request(app)
      .delete("/api/admin/users/1")
      .set("Authorization", `Bearer ${adminToken(1)}`);

    expect(res.status).toBe(400);
  });
});
