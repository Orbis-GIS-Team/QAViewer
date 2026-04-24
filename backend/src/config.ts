import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(process.cwd(), "..", ".env") });
dotenv.config();

const backendDir = process.cwd();
const repoRoot = path.resolve(backendDir, "..");

const jwtSecret = process.env.JWT_SECRET ?? "change-me";
if (jwtSecret === "change-me") {
  throw new Error(
    "JWT_SECRET is set to the insecure default. Set a strong secret via the JWT_SECRET environment variable.",
  );
}

export const config = {
  apiPort: Number(process.env.API_PORT ?? 3001),
  apiHost: process.env.API_HOST ?? "0.0.0.0",
  databaseUrl:
    process.env.DATABASE_URL ?? "postgres://qaviewer:qaviewer@localhost:5432/qaviewer",
  jwtSecret,
  demoMode: process.env.DEMO_MODE === "true",
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? "http://localhost:5173",
  backendDir,
  repoRoot,
  atlasWorkbookPath:
    process.env.ATLAS_WORKBOOK_PATH ?? path.join(repoRoot, "Combined_LR_Upload_First3Tabs.xlsx"),
  atlasDocumentRoot:
    process.env.ATLAS_DOCUMENT_ROOT ?? path.join(repoRoot, "LR_Documents"),
  taxParcelSourcePath:
    process.env.TAX_PARCEL_SOURCE_PATH ?? path.join(repoRoot, "DataBuild", "pa_warren_with_report_data.shp"),
  taxBillRoot:
    process.env.TAX_BILL_ROOT ?? path.join(repoRoot, "DataBuild", "TaxBills"),
  seedDir: path.join(repoRoot, "data", "standardized"),
  uploadsDir: path.join(backendDir, "uploads"),
};
