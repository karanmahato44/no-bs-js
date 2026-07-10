import { afterEach, describe, expect, it, vi } from "vitest";

import type { ScriptId } from "../domain/types";
import { getScripts, listScriptIndex } from "./storage";

const legacyRecord = {
  id: "script-1",
  source: "console.log(1);",
  sourceHash: "unused",
  meta: {
    name: "one",
    namespace: "legacy",
    version: "1.0.0",
    description: "legacy fields",
    matches: ["https://example.com/*"],
    excludeMatches: [],
    includeGlobs: [],
    excludeGlobs: [],
    grants: ["none"],
    runAt: "document_idle",
  },
  status: "enabled",
  position: 0,
  createdAt: 1,
  updatedAt: 2,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("storage decoding", () => {
  it("batch-loads records in order and strips legacy fields", async () => {
    const get = vi.fn().mockResolvedValue({
      "script:script-1": legacyRecord,
      "script:missing": null,
    });
    vi.stubGlobal("chrome", { storage: { local: { get } } });

    const records = await getScripts(["script-1", "missing"] as ScriptId[]);

    expect(get).toHaveBeenCalledWith(["script:script-1", "script:missing"]);
    expect(records).toEqual([
      {
        id: "script-1",
        source: "console.log(1);",
        meta: {
          name: "one",
          matches: ["https://example.com/*"],
          excludeMatches: [],
          includeGlobs: [],
          excludeGlobs: [],
          runAt: "document_idle",
        },
        status: "enabled",
        position: 0,
      },
      null,
    ]);
  });

  it("strips legacy index fields", async () => {
    const get = vi.fn().mockResolvedValue({
      scriptIndex: [
        {
          id: "script-1",
          name: "one",
          namespace: "legacy",
          status: "enabled",
          position: 0,
          updatedAt: 2,
        },
      ],
    });
    vi.stubGlobal("chrome", { storage: { local: { get } } });

    await expect(listScriptIndex()).resolves.toEqual([
      { id: "script-1", name: "one", status: "enabled", position: 0 },
    ]);
  });
});
