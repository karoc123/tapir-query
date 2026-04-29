import { mkdir, access, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const targetDir = path.join(__dirname, "downloads");

const samples = [
  {
    fileName: "customers-100.csv",
    url: "https://drive.google.com/uc?id=1zO8ekHWx9U7mrbx_0Hoxxu6od7uxJqWw&export=download",
  },
  {
    fileName: "organizations-100.csv",
    url: "https://drive.google.com/uc?id=13a2WyLoGxQKXbN_AIjrOogIlQKNe9uPm&export=download",
  },
];

async function ensureFile(sample) {
  const outputPath = path.join(targetDir, sample.fileName);

  try {
    await access(outputPath, fsConstants.F_OK);
    console.log(`fixture exists: ${sample.fileName}`);
    return;
  } catch {
    // Fall through to download.
  }

  console.log(`downloading fixture: ${sample.fileName}`);
  const response = await fetch(sample.url);
  if (!response.ok) {
    throw new Error(`failed to download ${sample.fileName}: HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/html")) {
    throw new Error(
      `failed to download ${sample.fileName}: received HTML instead of CSV. Check network access.`,
    );
  }

  const data = Buffer.from(await response.arrayBuffer());
  await writeFile(outputPath, data);
  console.log(`saved fixture: ${outputPath}`);
}

async function main() {
  await mkdir(targetDir, { recursive: true });

  for (const sample of samples) {
    await ensureFile(sample);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
