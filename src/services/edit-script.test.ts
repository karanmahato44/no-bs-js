import { describe, expect, it } from "vitest";

import type { UserScriptRecord } from "../domain/types";
import { updateScriptSource } from "./edit-script";

const originalSource = `// ==UserScript==
// @name old
// @match https://example.com/*
// @grant none
// ==/UserScript==
console.log("old");
`;

const nextSource = `// ==UserScript==
// @name next
// @namespace local
// @match https://example.org/*
// @grant none
// @run-at document-start
// ==/UserScript==
console.log("next");
`;

const record: UserScriptRecord = {
  id: "script-1" as UserScriptRecord["id"],
  source: originalSource,
  meta: {
    name: "old",
    matches: ["https://example.com/*"],
    excludeMatches: [],
    includeGlobs: [],
    excludeGlobs: [],
    runAt: "document_idle",
  },
  status: "enabled",
  position: 7,
};

describe("updateScriptSource", () => {
  it("rejects invalid edited source", () => {
    const result = updateScriptSource(record, "not a userscript");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("missing_metadata_block");
    }
  });

  it("updates source and metadata while preserving identity fields", () => {
    const result = updateScriptSource(record, nextSource);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.id).toBe(record.id);
    expect(result.value.status).toBe("enabled");
    expect(result.value.position).toBe(7);
    expect(result.value.source).toBe(nextSource);
    expect(result.value.meta.name).toBe("next");
    expect(result.value.meta.matches).toEqual(["https://example.org/*"]);
    expect(result.value.meta.runAt).toBe("document_start");
  });
});
