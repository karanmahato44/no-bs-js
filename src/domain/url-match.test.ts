import { describe, expect, it } from "vitest";

import {
  expandMatchPatterns,
  matchChromePattern,
  scriptMatchesUrl,
  scriptUrlMatchState,
} from "./url-match";
import type { ParsedUserScriptMeta } from "./types";

describe("matchChromePattern", () => {
  it("matches wildcard subdomains", () => {
    expect(matchChromePattern("https://*.reddit.com/*", "https://old.reddit.com/r/all")).toBe(true);
  });

  it("matches all urls", () => {
    expect(matchChromePattern("*://*/*", "https://example.com/x")).toBe(true);
  });
});

describe("scriptMatchesUrl", () => {
  it("honors exclude globs", () => {
    const meta: ParsedUserScriptMeta = {
      name: "x",
      namespace: null,
      version: null,
      description: null,
      matches: ["https://*.reddit.com/*"],
      excludeMatches: [],
      includeGlobs: [],
      excludeGlobs: ["https://old.reddit.com/*"],
      grants: [],
      runAt: "document_idle",
    };

    expect(scriptMatchesUrl(meta, "https://www.reddit.com/r/all")).toBe(true);
    expect(scriptMatchesUrl(meta, "https://old.reddit.com/r/all")).toBe(false);
    expect(scriptUrlMatchState(meta, "https://old.reddit.com/r/all")).toBe("excluded");
  });
});

describe("expandMatchPatterns", () => {
  it("adds current nepalstock host alias", () => {
    expect(expandMatchPatterns(["https://nepalstock.com.np/*"])).toContain(
      "https://nepalstock.com/*",
    );
  });
});
