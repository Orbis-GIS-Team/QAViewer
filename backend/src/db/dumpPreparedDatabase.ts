import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const repoRoot = path.resolve(process.cwd(), "..");
const outputPath = path.resolve(
  process.cwd(),
  process.env.PREPARED_DUMP_PATH ?? path.join(repoRoot, "qaviewer-prepared.dump"),
);
const containerName = process.env.PREPARED_DB_CONTAINER ?? "qaviewer-db-1";
const databaseName = process.env.POSTGRES_DB ?? "qaviewer";
const databaseUser = process.env.POSTGRES_USER ?? "qaviewer";

async function main(): Promise<void> {
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });

  console.log(`Writing prepared database dump to ${outputPath}`);
  console.log(`Source: Docker container ${containerName}, database ${databaseName}`);

  const output = fs.createWriteStream(outputPath, { flags: "w" });
  const dump = spawn(
    "docker",
    [
      "exec",
      containerName,
      "pg_dump",
      "--format=custom",
      "--no-owner",
      "--no-acl",
      "--username",
      databaseUser,
      "--dbname",
      databaseName,
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );

  dump.stdout.pipe(output);

  const outputFinished = new Promise<void>((resolve, reject) => {
    output.on("error", reject);
    output.on("finish", resolve);
  });

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    dump.on("error", reject);
    dump.on("close", resolve);
  });

  await outputFinished;

  if (exitCode !== 0) {
    await fs.promises.unlink(outputPath).catch(() => undefined);
    throw new Error(`pg_dump failed with exit code ${exitCode ?? "unknown"}.`);
  }

  console.log("Prepared database dump complete.");
}

main().catch((error) => {
  console.error("Prepared database dump failed.", error);
  process.exitCode = 1;
});
