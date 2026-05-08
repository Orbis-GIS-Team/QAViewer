/**
 * atlas.smoke.test.ts
 *
 * Protects the Atlas workbook/doc-tree API contract without a real database.
 * DB access is limited to auth middleware and Atlas service calls are mocked.
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

vi.mock("../src/lib/atlas.js", () => ({
  loadAtlasDocumentAsset: vi.fn(),
  loadAtlasFeaturelessDocuments: vi.fn(),
  loadAtlasImportReport: vi.fn(),
  loadAtlasQuestionAreaView: vi.fn(),
  normalizeAtlasBufferFeet: vi.fn((value: unknown) => {
    const parsed = Number(value);
    return [100, 500, 1000, 5000].includes(parsed) ? parsed : null;
  }),
}));

import { createApp } from "../src/app.js";
import {
  loadAtlasDocumentAsset,
  loadAtlasFeaturelessDocuments,
  loadAtlasImportReport,
  loadAtlasQuestionAreaView,
} from "../src/lib/atlas.js";
import { pool } from "../src/lib/db.js";

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

const atlasDocument = {
  documentNumber: "DOC-1",
  docName: "Parent.pdf",
  docType: "Deed",
  pageNo: "3",
  pageTarget: 3,
  packageRelativePath: "Parent.pdf",
  fileName: "Parent.pdf",
  extension: ".pdf",
  sizeBytes: 1024,
  hasFile: true,
  isPreviewable: true,
  contentUrl: "/api/atlas/documents/DOC-1/content",
  downloadUrl: "/api/atlas/documents/DOC-1/download",
};

describe("GET /api/question-areas/:code/atlas", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["admin", "gis_team", "land_records_team"] as const)(
    "allows %s to access Atlas question-area data",
    async (role) => {
      vi.mocked(loadAtlasQuestionAreaView).mockResolvedValueOnce({
        questionAreaCode: "QA-001",
        bufferValue: 500,
        bufferUnit: "feet",
        bufferGeometry: { type: "Polygon", coordinates: [] },
        matchedRecordCount: 0,
        linkedDocumentCount: 0,
        featurelessDocumentCount: 0,
        importRejectSummary: [],
        records: [],
        featurelessDocuments: [],
        warnings: [],
      });
      stubQuery(authResult(role));

      const res = await request(app)
        .get("/api/question-areas/QA-001/atlas")
        .set("Authorization", `Bearer ${makeToken(role)}`);

      expect(res.status).toBe(200);
      expect(loadAtlasQuestionAreaView).toHaveBeenCalledWith("QA-001", 500);
    },
  );

  it.each(["client", "other"] as const)("returns 403 for %s before loading Atlas data", async (role) => {
    stubQuery(authResult(role));

    const res = await request(app)
      .get("/api/question-areas/QA-001/atlas?buffer=500&unit=feet")
      .set("Authorization", `Bearer ${makeToken(role)}`);

    expect(res.status).toBe(403);
    expect(loadAtlasQuestionAreaView).not.toHaveBeenCalled();
  });

  it("returns parent document, child documents, featureless docs, rejects, warnings, and page targets", async () => {
    vi.mocked(loadAtlasQuestionAreaView).mockResolvedValueOnce({
      questionAreaCode: "QA-001",
      bufferValue: 500,
      bufferUnit: "feet",
      bufferGeometry: { type: "Polygon", coordinates: [] },
      matchedRecordCount: 1,
      linkedDocumentCount: 2,
      featurelessDocumentCount: 1,
      importRejectSummary: [{ code: "child_link", count: 4 }],
      records: [
        {
          lrNumber: "LR-1",
          tractKey: "TRACT-1",
          oldLrNumber: null,
          primaryDocumentNumber: "DOC-1",
          parentPageNo: "3",
          propertyName: "Property",
          fundName: "Fund",
          regionName: "Region",
          lrType: "Type",
          lrStatus: "Active",
          acqDate: null,
          taxParcelNumber: null,
          gisAcres: null,
          deedAcres: null,
          docDescriptionHeading: null,
          lrSpecs: null,
          township: null,
          range: null,
          section: null,
          fips: null,
          remark: null,
          sourceFile: "Combined_LR_Upload_First3Tabs.xlsx",
          sourceSheet: "LR Info Template",
          geometry: { type: "MultiPolygon", coordinates: [] },
          parentDocument: atlasDocument,
          childDocuments: [
            {
              ...atlasDocument,
              documentNumber: "DOC-2",
              docName: "Child.pdf",
              pageNo: "5",
              pageTarget: 5,
              contentUrl: "/api/atlas/documents/DOC-2/content",
              downloadUrl: "/api/atlas/documents/DOC-2/download",
            },
          ],
        },
      ],
      featurelessDocuments: [
        {
          ...atlasDocument,
          documentNumber: "DOC-F",
          docName: "Featureless.pdf",
          pageNo: null,
          pageTarget: null,
          contentUrl: "/api/atlas/documents/DOC-F/content",
          downloadUrl: "/api/atlas/documents/DOC-F/download",
        },
      ],
      warnings: [{ code: "import_rejects", message: "4 Atlas rows rejected.", severity: "warning" }],
    });
    stubQuery(AUTH_ADMIN);

    const res = await request(app)
      .get("/api/question-areas/QA-001/atlas?buffer=500&unit=feet")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(loadAtlasQuestionAreaView).toHaveBeenCalledWith("QA-001", 500);
    expect(res.body.records[0].parentDocument).toMatchObject({
      documentNumber: "DOC-1",
      pageNo: "3",
      pageTarget: 3,
    });
    expect(res.body.records[0].childDocuments[0]).toMatchObject({
      documentNumber: "DOC-2",
      pageNo: "5",
      pageTarget: 5,
    });
    expect(res.body.featurelessDocuments).toHaveLength(1);
    expect(res.body.importRejectSummary).toEqual([{ code: "child_link", count: 4 }]);
    expect(res.body.warnings[0]).toHaveProperty("code", "import_rejects");
  });

  it("rejects unsupported buffers before loading Atlas data", async () => {
    stubQuery(AUTH_ADMIN);

    const res = await request(app)
      .get("/api/question-areas/QA-001/atlas?buffer=42&unit=feet")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(400);
    expect(loadAtlasQuestionAreaView).not.toHaveBeenCalled();
  });

  it("rejects unsupported buffer units before loading Atlas data", async () => {
    stubQuery(AUTH_ADMIN);

    const res = await request(app)
      .get("/api/question-areas/QA-001/atlas?buffer=500&unit=meters")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(400);
    expect(loadAtlasQuestionAreaView).not.toHaveBeenCalled();
  });

  it("defaults the Atlas buffer to 500 feet", async () => {
    vi.mocked(loadAtlasQuestionAreaView).mockResolvedValueOnce({
      questionAreaCode: "QA-001",
      bufferValue: 500,
      bufferUnit: "feet",
      bufferGeometry: { type: "Polygon", coordinates: [] },
      matchedRecordCount: 0,
      linkedDocumentCount: 0,
      featurelessDocumentCount: 0,
      importRejectSummary: [],
      records: [],
      featurelessDocuments: [],
      warnings: [],
    });
    stubQuery(AUTH_ADMIN);

    const res = await request(app)
      .get("/api/question-areas/QA-001/atlas")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(loadAtlasQuestionAreaView).toHaveBeenCalledWith("QA-001", 500);
  });

  it("returns 404 when the question area has no Atlas view", async () => {
    vi.mocked(loadAtlasQuestionAreaView).mockResolvedValueOnce(null);
    stubQuery(AUTH_ADMIN);

    const res = await request(app)
      .get("/api/question-areas/NOPE-001/atlas?buffer=500&unit=feet")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(404);
  });
});

describe("GET /api/atlas support endpoints", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["client", "other"] as const)("returns 403 for %s before loading featureless documents", async (role) => {
    stubQuery(authResult(role));

    const res = await request(app)
      .get("/api/atlas/featureless-docs")
      .set("Authorization", `Bearer ${makeToken(role)}`);

    expect(res.status).toBe(403);
    expect(loadAtlasFeaturelessDocuments).not.toHaveBeenCalled();
  });

  it("returns featureless documents separately from matched land-record trees", async () => {
    vi.mocked(loadAtlasFeaturelessDocuments).mockResolvedValueOnce([
      { ...atlasDocument, documentNumber: "DOC-F", pageNo: null, pageTarget: null },
    ]);
    stubQuery(AUTH_ADMIN);

    const res = await request(app)
      .get("/api/atlas/featureless-docs")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("count", 1);
    expect(res.body.documents[0]).toHaveProperty("documentNumber", "DOC-F");
  });

  it("returns strict import reject reports", async () => {
    vi.mocked(loadAtlasImportReport).mockResolvedValueOnce({
      summary: [{ code: "land_record", count: 2 }],
      rejects: [
        {
          id: 1,
          entityType: "land_record",
          sourceSheet: "LR Info Template",
          sourceRowNumber: 7,
          rejectReason: "Parent DocumentNumber does not resolve.",
          rawData: { LR_Number: "LR-X" },
        },
      ],
    });
    stubQuery(AUTH_ADMIN);

    const res = await request(app)
      .get("/api/atlas/import-report?limit=10")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(loadAtlasImportReport).toHaveBeenCalledWith(10);
    expect(res.body.summary).toEqual([{ code: "land_record", count: 2 }]);
    expect(res.body.rejects[0]).toHaveProperty("sourceSheet", "LR Info Template");
  });

  it("defaults non-numeric import report limits to 200", async () => {
    vi.mocked(loadAtlasImportReport).mockResolvedValueOnce({ summary: [], rejects: [] });
    stubQuery(AUTH_ADMIN);

    const res = await request(app)
      .get("/api/atlas/import-report?limit=not-a-number")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(loadAtlasImportReport).toHaveBeenCalledWith(200);
  });

  it("returns 404 for an unknown Atlas document content request", async () => {
    vi.mocked(loadAtlasDocumentAsset).mockResolvedValueOnce(null);
    stubQuery(AUTH_ADMIN);

    const res = await request(app)
      .get("/api/atlas/documents/DOC-NOPE/content")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("message", "Atlas document not found.");
  });

  it("returns 415 for non-previewable Atlas document content", async () => {
    vi.mocked(loadAtlasDocumentAsset).mockResolvedValueOnce({
      ...atlasDocument,
      isPreviewable: false,
      contentUrl: null,
      mimeType: null,
      filePath: "C:\\dev\\QAViewer\\LR_Documents\\Document.docx",
      recordingInstrument: null,
      recordingDate: null,
      expirationDate: null,
      deedAcres: null,
      keywords: null,
      remark: null,
      sourceFile: null,
      propertyCode: null,
      propertyName: null,
    });
    stubQuery(AUTH_ADMIN);

    const res = await request(app)
      .get("/api/atlas/documents/DOC-DOCX/content")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(415);
    expect(res.body).toHaveProperty("message", "Inline preview is not supported for this Atlas document.");
  });

  it("reports missing package files for Atlas document download", async () => {
    vi.mocked(loadAtlasDocumentAsset).mockResolvedValueOnce({
      ...atlasDocument,
      hasFile: false,
      filePath: null,
      mimeType: null,
      recordingInstrument: null,
      recordingDate: null,
      expirationDate: null,
      deedAcres: null,
      keywords: null,
      remark: null,
      sourceFile: null,
      propertyCode: null,
      propertyName: null,
    });
    stubQuery(AUTH_ADMIN);

    const res = await request(app)
      .get("/api/atlas/documents/DOC-MISSING/download")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("message", "Atlas document file is missing from package storage.");
  });
});
