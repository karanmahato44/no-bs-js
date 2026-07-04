import type { ParsedUserScriptMeta } from "./types";

export type UrlMatchState = "active" | "excluded" | "none";

const allUrlsRegex = /^(https?|file|ftp):/;
const chromePatternRegexes = new Map<string, RegExp | null>();
const globRegexes = new Map<string, RegExp>();

export const scriptUrlMatchState = (meta: ParsedUserScriptMeta, url: string): UrlMatchState => {
  const included = scriptTargetsUrl(meta, url);

  if (!included) {
    return "none";
  }

  const excluded =
    meta.excludeMatches.some((pattern) => matchChromePattern(pattern, url)) ||
    meta.excludeGlobs.some((glob) => matchGlob(glob, url));

  return excluded ? "excluded" : "active";
};

export const scriptMatchesUrl = (meta: ParsedUserScriptMeta, url: string): boolean => {
  return scriptUrlMatchState(meta, url) === "active";
};

export const scriptTargetsUrl = (meta: ParsedUserScriptMeta, url: string): boolean =>
  meta.matches.some((pattern) => matchChromePatternWithAliases(pattern, url)) ||
  meta.includeGlobs.some((glob) => matchGlob(glob, url));

export const expandMatchPatterns = (patterns: readonly string[]): string[] => {
  const expanded: string[] = [];

  for (const pattern of patterns) {
    expanded.push(pattern);
    expanded.push(...expandKnownMovedHost(pattern));
  }

  return expanded;
};

export const matchChromePattern = (pattern: string, url: string): boolean => {
  if (pattern === "<all_urls>") {
    return allUrlsRegex.test(url);
  }

  const regex = compileChromePattern(pattern);
  return regex !== null && regex.test(url);
};

export const matchGlob = (glob: string, url: string): boolean => {
  const cached = globRegexes.get(glob);
  if (cached !== undefined) {
    return cached.test(url);
  }

  const regex = new RegExp(`^${globToRegexSource(glob)}$`);
  globRegexes.set(glob, regex);
  return regex.test(url);
};

const compileChromePattern = (pattern: string): RegExp | null => {
  const cached = chromePatternRegexes.get(pattern);
  if (cached !== undefined) {
    return cached;
  }

  const separatorIndex = pattern.indexOf("://");
  if (separatorIndex === -1) {
    chromePatternRegexes.set(pattern, null);
    return null;
  }

  const scheme = pattern.slice(0, separatorIndex);
  const rest = pattern.slice(separatorIndex + 3);
  const slashIndex = rest.indexOf("/");
  if (slashIndex === -1) {
    chromePatternRegexes.set(pattern, null);
    return null;
  }

  const host = rest.slice(0, slashIndex);
  const path = rest.slice(slashIndex);
  const regex = new RegExp(
    `^${schemeRegex(scheme)}://${hostRegex(host)}${globToRegexSource(path)}$`,
  );
  chromePatternRegexes.set(pattern, regex);
  return regex;
};

const expandKnownMovedHost = (pattern: string): string[] => {
  const separatorIndex = pattern.indexOf("://");
  if (separatorIndex === -1) {
    return [];
  }

  const scheme = pattern.slice(0, separatorIndex);
  const rest = pattern.slice(separatorIndex + 3);
  const slashIndex = rest.indexOf("/");
  if (slashIndex === -1) {
    return [];
  }

  const host = rest.slice(0, slashIndex);
  const path = rest.slice(slashIndex);

  if (host === "nepalstock.com.np") {
    return [`${scheme}://nepalstock.com${path}`];
  }

  if (host === "www.nepalstock.com.np") {
    return [`${scheme}://www.nepalstock.com${path}`, `${scheme}://nepalstock.com${path}`];
  }

  return [];
};

const matchChromePatternWithAliases = (pattern: string, url: string): boolean => {
  if (matchChromePattern(pattern, url)) {
    return true;
  }

  for (const alias of expandKnownMovedHost(pattern)) {
    if (matchChromePattern(alias, url)) {
      return true;
    }
  }

  return false;
};

const schemeRegex = (scheme: string): string => (scheme === "*" ? "https?" : escapeRegex(scheme));

const hostRegex = (host: string): string => {
  if (host === "*") {
    return "[^/]*";
  }

  if (host.startsWith("*.")) {
    const base = escapeRegex(host.slice(2));
    return `([^/]*\\.)?${base}`;
  }

  return escapeRegex(host);
};

const globToRegexSource = (glob: string): string => {
  let source = "";
  for (const char of glob) {
    if (char === "*") {
      source += ".*";
    } else if (char === "?") {
      source += ".";
    } else {
      source += escapeRegex(char);
    }
  }
  return source;
};

const escapeRegex = (value: string): string => value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
