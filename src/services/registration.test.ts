import { describe, expect, it } from "vitest";

import type { UserScriptRecord } from "../domain/types";
import { toRegisteredUserScript } from "./registration";

const record: UserScriptRecord = {
  id: "script-1" as UserScriptRecord["id"],
  sourceHash: "hash",
  source: "console.log('x');",
  meta: {
    name: "x",
    namespace: null,
    version: null,
    description: null,
    matches: ["https://*.reddit.com/*"],
    excludeMatches: ["https://old.reddit.com/*"],
    includeGlobs: [],
    excludeGlobs: ["https://old.reddit.com/*"],
    grants: ["none"],
    runAt: "document_idle",
  },
  status: "enabled",
  position: 1,
  createdAt: 100,
  updatedAt: 100,
};

describe("toRegisteredUserScript", () => {
  it("uses match-pattern excludes for site-disabled hosts", () => {
    const script = toRegisteredUserScript(record, {
      disabledHosts: ["old.reddit.com"],
      enabledHosts: [],
    });

    expect(script.excludeMatches ?? []).toContain("*://old.reddit.com/*");
    expect(script.excludeGlobs ?? []).not.toContain("*://old.reddit.com/*");
  });

  it("keeps ported host disables as globs", () => {
    const script = toRegisteredUserScript(record, {
      disabledHosts: ["localhost:5173"],
      enabledHosts: [],
    });

    expect(script.excludeMatches ?? []).not.toContain("*://localhost:5173/*");
    expect(script.excludeGlobs ?? []).toContain("*://localhost:5173/*");
  });

  it("removes matching metadata excludes when a host is site-enabled", () => {
    const script = toRegisteredUserScript(record, {
      disabledHosts: [],
      enabledHosts: ["old.reddit.com"],
    });

    expect(script.excludeMatches ?? []).not.toContain("https://old.reddit.com/*");
    expect(script.excludeGlobs ?? []).not.toContain("https://old.reddit.com/*");
  });
});
