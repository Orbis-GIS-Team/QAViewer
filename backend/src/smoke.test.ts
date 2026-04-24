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

type AtlasQueryResult = {
  questionAreaCode: string;
  bufferValue: number;
  bufferUnit: "feet";
  bufferGeometry: object;
  matchedRecordCount: number;
  linkedDocumentCount: number;
  records: Array<{
    parentDocument: {
      documentNumber: string;
      hasFile: boolean;
      isPreviewable: boolean;
    } | null;
    childDocuments: Array<{
      documentNumber: string;
      hasFile: boolean;
      isPreviewable: boolean;
    }>;
  }>;
  featurelessDocuments: Array<{
    documentNumber: string;
    hasFile: boolean;
    isPreviewable: boolean;
  }>;
  importRejectSummary: Array<{
    code: string;
    count: number;
  }>;
  warnings: Array<{
    code: string;
    message: string;
  }>;
};

type TaxBillResult = {
  billId: string;
  hasFile: boolean;
  isPreviewable: boolean;
};

type TaxParcelQueryResult = {
  questionAreaCode: string;
  bufferValue: number;
  bufferUnit: "feet";
  bufferGeometry: object;
  matchedParcelCount: number;
  matchedBillCount: number;
  parcels: Array<{
    parcelId: string;
    bills: TaxBillResult[];
  }>;
  warnings: Array<{
    code: string;
    message: string;
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
    responseType?: "json" | "none";
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

  if ((options.responseType ?? "json") === "none") {
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
    "/question-areas?bbox=-180,-90,180,90&limit=10",
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

  let atlasResult: AtlasQueryResult | null = null;
  for (const feature of questionAreas.features) {
    const atlasCode = String(feature.properties.code ?? "");
    if (!atlasCode) {
      continue;
    }

    const result = await request<AtlasQueryResult>(`/question-areas/${atlasCode}/atlas?buffer=500&unit=feet`, {
      token: admin.token,
    });

    atlasResult = result;
    if (result.linkedDocumentCount > 0 || result.matchedRecordCount > 0) {
      break;
    }
  }

  assert.ok(atlasResult);
  assert.equal(atlasResult?.bufferValue, 500);
  assert.equal(atlasResult?.bufferUnit, "feet");
  assert.ok(Array.isArray(atlasResult?.warnings));
  assert.ok(Array.isArray(atlasResult?.featurelessDocuments));
  assert.ok(Array.isArray(atlasResult?.importRejectSummary));

  const atlasDocument = (atlasResult?.records ?? [])
    .flatMap((record) => [
      ...(record.parentDocument ? [record.parentDocument] : []),
      ...record.childDocuments,
    ])
    .find((document) => document.hasFile);

  if (atlasDocument) {
    await request(
      `/atlas/documents/${encodeURIComponent(atlasDocument.documentNumber)}/download`,
      {
        method: "GET",
        token: admin.token,
        expectedStatus: 200,
        responseType: "none",
      },
    );

    await request(
      `/atlas/documents/${encodeURIComponent(atlasDocument.documentNumber)}/content`,
      {
        method: "GET",
        token: admin.token,
        expectedStatus: atlasDocument.isPreviewable ? 200 : 415,
        responseType: atlasDocument.isPreviewable ? "none" : "json",
      },
    );
  }

  const taxParcelResult = await request<TaxParcelQueryResult>(
    "/question-areas/QA-0073/tax-parcels?buffer=500&unit=feet",
    { token: admin.token },
  );
  assert.equal(taxParcelResult.questionAreaCode, "QA-0073");
  assert.equal(taxParcelResult.bufferValue, 500);
  assert.equal(taxParcelResult.bufferUnit, "feet");
  assert.ok(Array.isArray(taxParcelResult.parcels));
  assert.ok(Array.isArray(taxParcelResult.warnings));

  const taxBill = taxParcelResult.parcels
    .flatMap((parcel) => parcel.bills)
    .find((bill) => bill.hasFile);

  if (taxBill) {
    await request(`/tax-parcels/bills/${encodeURIComponent(taxBill.billId)}/download`, {
      method: "GET",
      token: admin.token,
      expectedStatus: 200,
      responseType: "none",
    });

    await request(`/tax-parcels/bills/${encodeURIComponent(taxBill.billId)}/content`, {
      method: "GET",
      token: admin.token,
      expectedStatus: taxBill.isPreviewable ? 200 : 415,
      responseType: taxBill.isPreviewable ? "none" : "json",
    });
  }

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
