import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const projectRoot = path.resolve(import.meta.dirname, "../..");

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`Could not find ${name} in page source.`);
  const firstBrace = source.indexOf("{", start);
  let depth = 0;
  for (let index = firstBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not parse ${name} in page source.`);
}

export async function loadNoteSuggestions(pageFile, nowMs) {
  const source = await readFile(path.join(projectRoot, pageFile), "utf8");
  const names = [
    "normalizeNotesSuggestionWeeks",
    "blockMatchesCategoryIdentity",
    "getTimeCodeIdentityFromCode",
    "blockMatchesTimeCodeIdentity",
    "buildCategoryNoteSuggestions",
  ];
  const functions = names.map((name) => extractFunction(source, name)).join("\n");
  const sandbox = {
    Date: class extends Date {
      static now() {
        return nowMs;
      }
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(`${functions}\nglobalThis.suggestions = buildCategoryNoteSuggestions;`, sandbox, {
    filename: pageFile,
  });
  return sandbox.suggestions;
}
