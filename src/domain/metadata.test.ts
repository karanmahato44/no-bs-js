import { describe, expect, it } from "vitest";

import { parseUserScriptMeta } from "./metadata";

const validSource = `// ==UserScript==
// @name        test script
// @namespace   local
// @version     1.2.3
// @description Does one thing
// @match       https://example.com/*
// @exclude-match https://example.com/private/*
// @grant       none
// @run-at      document_start
// ==/UserScript==
console.log("hi");
`;

describe("parseUserScriptMeta", () => {
  it("parses supported metadata", () => {
    const result = parseUserScriptMeta(validSource);

    expect(result).toEqual({
      ok: true,
      value: {
        name: "test script",
        namespace: "local",
        version: "1.2.3",
        description: "Does one thing",
        matches: ["https://example.com/*"],
        excludeMatches: ["https://example.com/private/*"],
        includeGlobs: [],
        excludeGlobs: [],
        grants: ["none"],
        runAt: "document_start",
      },
    });
  });

  it("rejects missing metadata blocks", () => {
    const result = parseUserScriptMeta(`console.log("x");`);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("missing_metadata_block");
    }
  });

  it("rejects multiple metadata blocks", () => {
    const result = parseUserScriptMeta(`// ==UserScript==
// @name x
// @match https://example.com/*
// ==/UserScript==
// ==UserScript==
// @name y
// @match https://example.org/*
// ==/UserScript==`);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("multiple_metadata_blocks");
    }
  });

  it("rejects missing name", () => {
    const result = parseUserScriptMeta(`// ==UserScript==
// @match https://example.com/*
// ==/UserScript==`);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("missing_name");
    }
  });

  it("rejects missing match and include directives", () => {
    const result = parseUserScriptMeta(`// ==UserScript==
// @name x
// ==/UserScript==`);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("missing_match");
    }
  });

  it("rejects unsupported grants", () => {
    const result = parseUserScriptMeta(`// ==UserScript==
// @name x
// @match https://example.com/*
// @grant GM_getValue
// ==/UserScript==`);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("unsupported_grant");
    }
  });

  it("rejects unsupported require directives", () => {
    const result = parseUserScriptMeta(`// ==UserScript==
// @name x
// @match https://example.com/*
// @require https://example.com/x.js
// ==/UserScript==`);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("unsupported_directive");
    }
  });

  it("rejects invalid run-at values", () => {
    const result = parseUserScriptMeta(`// ==UserScript==
// @name x
// @match https://example.com/*
// @run-at document-middle
// ==/UserScript==`);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("invalid_run_at");
    }
  });

  it("normalizes userscript run-at aliases", () => {
    const result = parseUserScriptMeta(`// ==UserScript==
// @name x
// @match https://example.com/*
// @run-at document-start
// ==/UserScript==`);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.runAt).toBe("document_start");
    }
  });

  it("maps document-body to document_end", () => {
    const result = parseUserScriptMeta(`// ==UserScript==
// @name x
// @match https://example.com/*
// @run-at document-body
// ==/UserScript==`);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.runAt).toBe("document_end");
    }
  });

  it("rejects invalid match patterns", () => {
    const result = parseUserScriptMeta(`// ==UserScript==
// @name x
// @match https://
// ==/UserScript==`);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("invalid_match_pattern");
    }
  });

  it("allows include-only scripts", () => {
    const result = parseUserScriptMeta(`// ==UserScript==
// @name x
// @include https://example.com/*
// ==/UserScript==`);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.includeGlobs).toEqual(["https://example.com/*"]);
    }
  });

  it("parses exclude globs", () => {
    const result = parseUserScriptMeta(`// ==UserScript==
// @name x
// @match *://*/*
// @exclude https://docs.google.com/spreadsheets/*
// ==/UserScript==`);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.excludeGlobs).toEqual(["https://docs.google.com/spreadsheets/*"]);
    }
  });
});
