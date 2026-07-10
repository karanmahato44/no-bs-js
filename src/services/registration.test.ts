import { describe, expect, it } from "vitest";

import type { UserScriptRecord } from "../domain/types";
import { createRegistrationPlan, toRegisteredUserScript } from "./registration";

const record: UserScriptRecord = {
  id: "script-1" as UserScriptRecord["id"],
  source: "console.log('x');",
  meta: {
    name: "x",
    matches: ["https://*.reddit.com/*"],
    excludeMatches: ["https://old.reddit.com/*"],
    includeGlobs: [],
    excludeGlobs: ["https://old.reddit.com/*"],
    runAt: "document_idle",
  },
  status: "enabled",
  position: 1,
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

describe("createRegistrationPlan", () => {
  const registered = (id: string): chrome.userScripts.RegisteredUserScript => ({
    id,
    matches: ["https://example.com/*"],
    js: [{ code: id }],
  });

  it("batches stale removal, updates, and new registrations", () => {
    const next = { ...registered("keep"), js: [{ code: "changed" }] };
    const plan = createRegistrationPlan(
      [registered("stale"), registered("keep")],
      [next, registered("new")],
    );

    expect(plan.unregisterIds).toEqual(["stale"]);
    expect(plan.updates).toEqual([next]);
    expect(plan.registrations.map((script) => script.id)).toEqual(["new"]);
  });

  it("skips unchanged registrations", () => {
    const script = registered("same");
    const plan = createRegistrationPlan([script], [registered("same")]);

    expect(plan).toEqual({ unregisterIds: [], updates: [], registrations: [] });
  });
});
