import { validateMatchPattern, type MatchPatternError } from "./match-pattern";
import { err, ok, type ParsedUserScriptMeta, type Result, type RunAt } from "./types";

export type ParseError =
  | { kind: "missing_metadata_block"; message: string }
  | { kind: "multiple_metadata_blocks"; message: string }
  | { kind: "missing_name"; message: string }
  | { kind: "missing_match"; message: string }
  | { kind: "unsupported_directive"; directive: string; message: string }
  | { kind: "unsupported_grant"; grant: string; message: string }
  | { kind: "invalid_run_at"; value: string; message: string }
  | MatchPatternError;

const startMarker = "==UserScript==";
const endMarker = "==/UserScript==";

export const parseUserScriptMeta = (source: string): Result<ParsedUserScriptMeta, ParseError> => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);

  if (start === -1 || end === -1 || end <= start) {
    return err({ kind: "missing_metadata_block", message: "missing userscript metadata block" });
  }

  if (
    source.indexOf(startMarker, start + startMarker.length) !== -1 ||
    source.indexOf(endMarker, end + endMarker.length) !== -1
  ) {
    return err({ kind: "multiple_metadata_blocks", message: "multiple metadata blocks found" });
  }

  const block = source.slice(start + startMarker.length, end);
  const fields = parseDirectiveLines(block);

  for (const directive of fields.keys()) {
    if (directive === "require" || directive === "resource") {
      return err({
        kind: "unsupported_directive",
        directive,
        message: `@${directive} unsupported in v1`,
      });
    }
  }

  const name = firstValue(fields, "name");
  if (name === null) {
    return err({ kind: "missing_name", message: "missing @name" });
  }

  const matches = values(fields, "match");
  const includeGlobs = values(fields, "include");
  if (matches.length === 0 && includeGlobs.length === 0) {
    return err({ kind: "missing_match", message: "missing @match or @include" });
  }

  for (const pattern of matches) {
    const validated = validateMatchPattern(pattern);
    if (!validated.ok) {
      return err(validated.error);
    }
  }

  const excludeMatches = values(fields, "exclude-match");
  for (const pattern of excludeMatches) {
    const validated = validateMatchPattern(pattern);
    if (!validated.ok) {
      return err(validated.error);
    }
  }

  const grants = values(fields, "grant");
  for (const grant of grants) {
    if (grant !== "none") {
      return err({
        kind: "unsupported_grant",
        grant,
        message: `@grant ${grant} unsupported in v1`,
      });
    }
  }

  const runAtResult = parseRunAt(firstValue(fields, "run-at"));
  if (!runAtResult.ok) {
    return err(runAtResult.error);
  }

  return ok({
    name,
    namespace: firstValue(fields, "namespace"),
    version: firstValue(fields, "version"),
    description: firstValue(fields, "description"),
    matches,
    excludeMatches,
    includeGlobs,
    excludeGlobs: values(fields, "exclude"),
    grants,
    runAt: runAtResult.value,
  });
};

const parseDirectiveLines = (block: string): Map<string, string[]> => {
  const fields = new Map<string, string[]>();

  for (const rawLine of block.split(/\r?\n/)) {
    let line = rawLine.trimStart();
    if (line.startsWith("//")) {
      line = line.slice(2).trimStart();
    } else {
      line = line.trim();
    }

    if (!line.startsWith("@")) {
      continue;
    }

    const separator = firstWhitespaceIndex(line);
    const directive = line.slice(1, separator).trim();
    if (directive.length === 0) {
      continue;
    }

    const value = separator === line.length ? "" : line.slice(separator).trim();

    const existing = fields.get(directive) ?? [];
    existing.push(value);
    fields.set(directive, existing);
  }

  return fields;
};

const firstValue = (fields: Map<string, string[]>, key: string): string | null => {
  const value = fields.get(key)?.[0]?.trim();
  return value === undefined || value === "" ? null : value;
};

const values = (fields: Map<string, string[]>, key: string): string[] => {
  const rawValues = fields.get(key);
  if (rawValues === undefined) {
    return [];
  }

  const result: string[] = [];
  for (const rawValue of rawValues) {
    const value = rawValue.trim();
    if (value.length > 0) {
      result.push(value);
    }
  }
  return result;
};

const firstWhitespaceIndex = (value: string): number => {
  for (let index = 1; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 9 || code === 10 || code === 13 || code === 32) {
      return index;
    }
  }
  return value.length;
};

const parseRunAt = (
  value: string | null,
): Result<RunAt, Extract<ParseError, { kind: "invalid_run_at" }>> => {
  const normalized = normalizeRunAt(value);

  if (normalized === "document_idle") {
    return ok("document_idle");
  }

  if (normalized === "document_start" || normalized === "document_end") {
    return ok(normalized);
  }

  return err({
    kind: "invalid_run_at",
    value: value ?? "",
    message: `invalid @run-at ${value}; expected document_start, document_end, or document_idle`,
  });
};

const normalizeRunAt = (value: string | null): RunAt | string => {
  if (value === null || value === "document-idle") {
    return "document_idle";
  }

  if (value === "document-start") {
    return "document_start";
  }

  if (value === "document-end" || value === "document-body") {
    return "document_end";
  }

  return value;
};
