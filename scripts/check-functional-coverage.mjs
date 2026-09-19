import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const overview = await readFile("docs/functional-overview.md", "utf8");
const matrix = await readFile("docs/functional-test-matrix.md", "utf8");
const featureIds = [...overview.matchAll(/\[([A-Z]+-[A-Z]+-\d{2})\]/g)].map((match) => match[1]);
const uniqueFeatureIds = [...new Set(featureIds)];

if (featureIds.length !== uniqueFeatureIds.length) {
  throw new Error("Each functional-overview feature ID must appear exactly once.");
}

async function findTestFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return findTestFiles(entryPath);
      return entry.isFile() && entry.name.endsWith(".test.mjs") ? [entryPath] : [];
    })
  );
  return files.flat();
}

const testFiles = await findTestFiles("test");
const testSource = (await Promise.all(testFiles.map((file) => readFile(file, "utf8")))).join("\n");
const rows = [...matrix.matchAll(/^\| (F-[A-Z]+-\d{2}) \| (Automated|Manual|Planned) \| (.+) \|$/gm)].map(
  ([, id, status, evidence]) => ({ id, status, evidence })
);
const rowsById = new Map();

for (const row of rows) {
  if (rowsById.has(row.id)) throw new Error(`Feature ${row.id} appears more than once in the test matrix.`);
  rowsById.set(row.id, row);
}

const missingRows = uniqueFeatureIds.filter((id) => !rowsById.has(id));
const unknownRows = rows.filter((row) => !uniqueFeatureIds.includes(row.id));
if (missingRows.length || unknownRows.length) {
  const details = [
    missingRows.length ? `Missing matrix rows: ${missingRows.join(", ")}` : "",
    unknownRows.length ? `Unknown matrix rows: ${unknownRows.map((row) => row.id).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(". ");
  throw new Error(details);
}

const automatedWithoutTest = rows
  .filter((row) => row.status === "Automated" && !testSource.includes(`[${row.id}]`))
  .map((row) => row.id);
if (automatedWithoutTest.length) {
  throw new Error(`Automated features need a matching test tag: ${automatedWithoutTest.join(", ")}`);
}

const counts = Object.groupBy(rows, ({ status }) => status);
console.log(
  `Functional coverage map is valid: ${rows.length} features (${counts.Automated?.length || 0} automated, ${counts.Manual?.length || 0} manual, ${counts.Planned?.length || 0} planned).`
);
