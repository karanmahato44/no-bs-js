import { err, ok, type Result } from "./types";

export type MatchPatternError = {
  kind: "invalid_match_pattern";
  pattern: string;
  message: string;
};

const validSchemes = new Set(["http", "https", "file", "ftp", "*"]);

export const validateMatchPattern = (pattern: string): Result<string, MatchPatternError> => {
  if (pattern === "<all_urls>") {
    return ok(pattern);
  }

  const separatorIndex = pattern.indexOf("://");
  if (separatorIndex < 1) {
    return invalid(pattern, "missing scheme separator");
  }

  const scheme = pattern.slice(0, separatorIndex);
  if (!validSchemes.has(scheme)) {
    return invalid(pattern, "invalid scheme");
  }

  const afterScheme = pattern.slice(separatorIndex + 3);
  const slashIndex = afterScheme.indexOf("/");
  if (slashIndex < 0) {
    return invalid(pattern, "missing path");
  }

  const host = afterScheme.slice(0, slashIndex);
  const path = afterScheme.slice(slashIndex);

  if (path.length === 0 || !path.startsWith("/")) {
    return invalid(pattern, "invalid path");
  }

  if (scheme === "file") {
    return host === "" ? ok(pattern) : invalid(pattern, "file pattern host must be empty");
  }

  if (host.length === 0) {
    return invalid(pattern, "missing host");
  }

  if (host.includes("*") && host !== "*" && !host.startsWith("*.")) {
    return invalid(pattern, "wildcard host must be * or start with *.");
  }

  return ok(pattern);
};

const invalid = (pattern: string, message: string): Result<string, MatchPatternError> =>
  err({ kind: "invalid_match_pattern", pattern, message });
