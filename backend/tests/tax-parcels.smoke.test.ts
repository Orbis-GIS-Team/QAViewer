/**
 * tax-parcels.smoke.test.ts
 *
 * Protects the tax parcel workspace API contract without a real database.
 * DB access is limited to auth middleware and tax parcel service calls are mocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";
import request from "supertest";

vi.mock("pg", () => {
  const mockQuery = vi.fn();
  class Pool {
    query = mockQuery;
    connect = vi.fn();
    end = vi.fn();
  }
  return { Pool, default: { Pool } };
});

vi.mock("../src/lib/taxParcels.js", () => ({
  loadTaxBillAsset: vi.fn(),
  loadTaxParcelQuestionAreaView: vi.fn(),
  normalizeTaxParcelBufferFeet: vi.fn((value: unknown) => {
    const parsed = Number(value);
    return [100, 500, 1000, 5000].includes(parsed) ? parsed : null;
  }),
}));

import { createApp } from "../src/app.js";
import { pool } from "../src/lib/db.js";
import {
  loadTaxBillAsset,
  loadTaxParcelQuestionAreaView,
} from "../src/lib/taxParcels.js";

const JWT_SECRET = "test-secret-for-vitest-do-not-use-in-prod";
const app = createApp();

type TestRole = "admin" | "gis_team" | "land_records_team" | "client" | "other";

function makeToken(role: TestRole = "admin", id = 1) {
  return jwt.sign({ id, email: "user@test.com", name: "Tester", role }, JWT_SECRET, {
    expiresIn: "1h",
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function stubQuery(...results: any[]) {
  let spy = vi.spyOn(pool, "query");
  for (const result of results) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    spy = spy.mockResolvedValueOnce(result as any);
  }
  return spy;
}

function authResult(role: TestRole, id = 1) {
  return { rows: [{ id, email: "user@test.com", name: "Tester", role }] };
}

const AUTH_ADMIN = authResult("admin");

const taxBill = {
  billId: "tax-bill-123",
  parcelId: "58567",
  year: 2025,
  filename: "2025_58567.pdf",
  extension: ".pdf",
  sizeBytes: 291875,
  hasFile: true,
  isPreviewable: true,
  contentUrl: "/api/tax-parcels/bills/tax-bill-123/content",
  downloadUrl: "/api/tax-parcels/bills/tax-bill-123/download",
};

describe("GET /api/question-areas/:code/tax-parcels", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["admin", "gis_team", "land_records_team"] as const)(
    "allows %s to access tax parcel question-area data",
    async (role) => {
      vi.mocked(loadTaxParcelQuestionAreaView).mockResolvedValueOnce({
        questionAreaCode: "QA-0073",
        bufferValue: 500,
        bufferUnit: "feet",
        bufferGeometry: { type: "Polygon", coordinates: [] },
        matchedParcelCount: 0,
        matchedBillCount: 0,
        parcels: [],
        warnings: [],
      });
      stubQuery(authResult(role));

      const res = await request(app)
        .get("/api/question-areas/QA-0073/tax-parcels")
        .set("Authorization", `Bearer ${makeToken(role)}`);

      expect(res.status).toBe(200);
      expect(loadTaxParcelQuestionAreaView).toHaveBeenCalledWith("QA-0073", 500);
    },
  );

  it.each(["client", "other"] as const)("returns 403 for %s before loading tax parcel data", async (role) => {
    stubQuery(authResult(role));

    const res = await request(app)
      .get("/api/question-areas/QA-0073/tax-parcels?buffer=500&unit=feet")
      .set("Authorization", `Bearer ${makeToken(role)}`);

    expect(res.status).toBe(403);
    expect(loadTaxParcelQuestionAreaView).not.toHaveBeenCalled();
  });

  it("returns ranked parcel matches with linked bills", async () => {
    vi.mocked(loadTaxParcelQuestionAreaView).mockResolvedValueOnce({
      questionAreaCode: "QA-0073",
      bufferValue: 500,
      bufferUnit: "feet",
      bufferGeometry: { type: "Polygon", coordinates: [] },
      matchedParcelCount: 1,
      matchedBillCount: 2,
      parcels: [
        {
          parcelId: "58567",
          parcelCode: "TD-005-185000-000",
          accountNumber: "TD-005-185000-000",
          ownerName: "730 Texas Timberlands",
          propertyName: "Latrobe",
          parcelStatus: "Active",
          taxProgram: "Not Enrolled",
          ownershipType: "Fee Simple",
          county: "Warren",
          state: "PA",
          gisAcres: 104,
          description: "Joined parcel match",
          landUseType: "Timber",
          tractName: null,
          notes: null,
          overlapAreaSqMeters: 25000,
          pointDistanceMeters: 9.5,
          primaryRank: 1,
          isPrimaryMatch: true,
          geometry: { type: "MultiPolygon", coordinates: [] },
          bills: [
            taxBill,
            {
              ...taxBill,
              billId: "tax-bill-456",
              year: 2024,
              filename: "2024_58567.pdf",
              contentUrl: "/api/tax-parcels/bills/tax-bill-456/content",
              downloadUrl: "/api/tax-parcels/bills/tax-bill-456/download",
            },
          ],
        },
      ],
      warnings: [],
    });
    stubQuery(AUTH_ADMIN);

    const res = await request(app)
      .get("/api/question-areas/QA-0073/tax-parcels?buffer=500&unit=feet")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(loadTaxParcelQuestionAreaView).toHaveBeenCalledWith("QA-0073", 500);
    expect(res.body).toMatchObject({
      questionAreaCode: "QA-0073",
      matchedParcelCount: 1,
      matchedBillCount: 2,
    });
    expect(res.body.parcels[0]).toMatchObject({
      parcelId: "58567",
      parcelCode: "TD-005-185000-000",
      isPrimaryMatch: true,
    });
    expect(res.body.parcels[0].bills).toHaveLength(2);
  });

  it("rejects unsupported buffers before loading tax parcel data", async () => {
    stubQuery(AUTH_ADMIN);

    const res = await request(app)
      .get("/api/question-areas/QA-0073/tax-parcels?buffer=42&unit=feet")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(400);
    expect(loadTaxParcelQuestionAreaView).not.toHaveBeenCalled();
  });

  it("rejects unsupported buffer units before loading tax parcel data", async () => {
    stubQuery(AUTH_ADMIN);

    const res = await request(app)
      .get("/api/question-areas/QA-0073/tax-parcels?buffer=500&unit=meters")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(400);
    expect(loadTaxParcelQuestionAreaView).not.toHaveBeenCalled();
  });

  it("defaults the tax parcel buffer to 500 feet", async () => {
    vi.mocked(loadTaxParcelQuestionAreaView).mockResolvedValueOnce({
      questionAreaCode: "QA-0073",
      bufferValue: 500,
      bufferUnit: "feet",
      bufferGeometry: { type: "Polygon", coordinates: [] },
      matchedParcelCount: 0,
      matchedBillCount: 0,
      parcels: [],
      warnings: [],
    });
    stubQuery(AUTH_ADMIN);

    const res = await request(app)
      .get("/api/question-areas/QA-0073/tax-parcels")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(loadTaxParcelQuestionAreaView).toHaveBeenCalledWith("QA-0073", 500);
  });

  it("returns 404 when the question area has no tax parcel view", async () => {
    vi.mocked(loadTaxParcelQuestionAreaView).mockResolvedValueOnce(null);
    stubQuery(AUTH_ADMIN);

    const res = await request(app)
      .get("/api/question-areas/NOPE-001/tax-parcels?buffer=500&unit=feet")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(404);
  });
});

describe("GET /api/tax-parcels bill endpoints", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["client", "other"] as const)("returns 403 for %s before loading tax bill content", async (role) => {
    stubQuery(authResult(role));

    const res = await request(app)
      .get("/api/tax-parcels/bills/tax-bill-123/content")
      .set("Authorization", `Bearer ${makeToken(role)}`);

    expect(res.status).toBe(403);
    expect(loadTaxBillAsset).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown tax bill content request", async () => {
    vi.mocked(loadTaxBillAsset).mockResolvedValueOnce(null);
    stubQuery(AUTH_ADMIN);

    const res = await request(app)
      .get("/api/tax-parcels/bills/nope/content")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("message", "Tax bill not found.");
  });

  it("returns 415 for a non-previewable tax bill content request", async () => {
    vi.mocked(loadTaxBillAsset).mockResolvedValueOnce({
      ...taxBill,
      isPreviewable: false,
      contentUrl: null,
      filePath: "C:\\dev\\QAViewer\\DataBuild\\TaxBills\\2025_58567.docx",
      mimeType: null,
    });
    stubQuery(AUTH_ADMIN);

    const res = await request(app)
      .get("/api/tax-parcels/bills/tax-bill-123/content")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(415);
    expect(res.body).toHaveProperty("message", "Inline preview is not supported for this tax bill.");
  });

  it("reports missing files for tax bill download", async () => {
    vi.mocked(loadTaxBillAsset).mockResolvedValueOnce({
      ...taxBill,
      hasFile: false,
      filePath: null,
      mimeType: null,
    });
    stubQuery(AUTH_ADMIN);

    const res = await request(app)
      .get("/api/tax-parcels/bills/tax-bill-123/download")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("message", "Tax bill file is missing from package storage.");
  });
});
