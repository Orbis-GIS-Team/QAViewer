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

const startupDataModes = ["validate"] as const;
type StartupDataMode = (typeof startupDataModes)[number];

function parseStartupDataMode(value: string | undefined): StartupDataMode {
  const mode = value ?? "validate";
  if (startupDataModes.includes(mode as StartupDataMode)) {
    return mode as StartupDataMode;
  }

  throw new Error(`Invalid STARTUP_DATA_MODE "${mode}". Expected: validate.`);
}

function parseIntegerEnv(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`Invalid ${name} "${value}". Expected an integer.`);
  }

  return parsed;
}

export const config = {
  apiPort: parseIntegerEnv("API_PORT/PORT", process.env.API_PORT ?? process.env.PORT, 3001),
  apiHost: process.env.API_HOST ?? "0.0.0.0",
  databaseUrl:
    process.env.DATABASE_URL ?? "postgres://qaviewer:qaviewer@localhost:5432/qaviewer",
  jwtSecret,
  demoMode: process.env.DEMO_MODE === "true",
  startupDataMode: parseStartupDataMode(process.env.STARTUP_DATA_MODE),
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
  propertyTaxParcelWorkbookPath:
    path.resolve(
      repoRoot,
      process.env.PROPERTY_TAX_PARCEL_WORKBOOK_PATH
      ?? path.join("PropertyTax Map implementation", "ParcelsListingReport.xlsx"),
    ),
  regridFeatureServiceUrl: process.env.REGRID_FEATURE_SERVICE_URL ?? "",
  propertyTaxRegridMinZoom: parseIntegerEnv(
    "PROPERTY_TAX_REGRID_MIN_ZOOM",
    process.env.PROPERTY_TAX_REGRID_MIN_ZOOM,
    12,
  ),
  seedDir: path.join(repoRoot, "data", "standardized"),
  uploadsDir: path.join(backendDir, "uploads"),
  supabaseUrl: process.env.SUPABASE_URL ?? "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  supabaseStorageBucket: process.env.SUPABASE_STORAGE_BUCKET ?? "",
};
