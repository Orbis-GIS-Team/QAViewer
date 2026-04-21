import assert from "node:assert/strict";
import test from "node:test";

const API_BASE = process.env.QA_SMOKE_API_URL ?? "http://localhost:3001/api";
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type Session = {
  token: string;
  user: {
    id: number;
    email: string;
    name: string;
    role: "admin" | "client";
  };
};

type FeatureCollection = {
  features: Array<{
    properties: Record<string, unknown>;
  }>;
};

async function request<T>(
  path: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
    formData?: FormData;
    expectedStatus?: number;
  } = {},
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.formData ?? (options.body ? JSON.stringify(options.body) : undefined),
  });

  const expectedStatus = options.expectedStatus ?? 200;
  assert.equal(response.status, expectedStatus, `${path} returned ${response.status}`);

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

async function login(email: string, password: string): Promise<Session> {
  return request<Session>("/auth/login", {
    method: "POST",
    body: { email, password },
  });
}

test("auth, admin, question-area, and layer smoke flow", async () => {
  const admin = await login("admin@qaviewer.local", "admin123!");
  assert.equal(admin.user.role, "admin");

  await request("/auth/login", {
    method: "POST",
    body: { email: "admin@qaviewer.local", password: "wrong-password" },
    expectedStatus: 401,
  });

  const created = await request<{ user: Session["user"] }>(
    "/admin/users",
    {
      method: "POST",
      token: admin.token,
      body: {
        name: "Smoke Test User",
        email: `smoke-${RUN_ID}@qaviewer.local`,
        role: "client",
        password: "smoke123!",
      },
      expectedStatus: 201,
    },
  );

  const smokeSession = await login(created.user.email, "smoke123!");
  assert.equal(smokeSession.user.role, "client");

  await request(`/admin/users/${created.user.id}`, {
    method: "PATCH",
    token: admin.token,
    body: { name: "Smoke Test User Updated" },
  });

  const questionAreas = await request<FeatureCollection>(
    "/question-areas?bbox=-180,-90,180,90&limit=1",
    { token: admin.token },
  );
  const questionAreaCode = String(questionAreas.features[0]?.properties.code ?? "");
  assert.match(questionAreaCode, /^QA-/);

  await request(`/question-areas/${questionAreaCode}`, {
    method: "PATCH",
    token: admin.token,
    body: {
      status: "review",
      summary: `Smoke summary ${RUN_ID}`,
    },
  });

  await request(`/question-areas/${questionAreaCode}/comments`, {
    method: "POST",
    token: smokeSession.token,
    body: { body: `Smoke question-area comment ${RUN_ID}` },
    expectedStatus: 201,
  });

  const uploadBody = new FormData();
  uploadBody.append("file", new Blob([`smoke upload ${RUN_ID}`], { type: "text/plain" }), `smoke-${RUN_ID}.txt`);
  await request(`/question-areas/${questionAreaCode}/documents`, {
    method: "POST",
    token: admin.token,
    formData: uploadBody,
    expectedStatus: 201,
  });

  const landRecords = await request<FeatureCollection>(
    "/layers/land_records?bbox=-180,-90,180,90",
    { token: admin.token },
  );
  const landRecordId = Number(landRecords.features[0]?.properties.id);
  assert.ok(Number.isInteger(landRecordId) && landRecordId > 0);

  const managementAreas = await request<FeatureCollection>(
    "/layers/management_areas?bbox=-180,-90,180,90",
    { token: admin.token },
  );
  const managementAreaId = Number(managementAreas.features[0]?.properties.id);
  assert.ok(Number.isInteger(managementAreaId) && managementAreaId > 0);

  await request(`/admin/users/${created.user.id}`, {
    method: "DELETE",
    token: admin.token,
    expectedStatus: 409,
  });
});
