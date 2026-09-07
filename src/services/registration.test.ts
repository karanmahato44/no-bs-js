import { afterEach, describe, expect, it, vi } from "vitest";

import type { UserScriptRecord } from "../domain/types";
import {
  createRegistrationPlan,
  reconcileRegistrations,
  syncScriptRegistration,
  toRegisteredUserScript,
} from "./registration";

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("toRegisteredUserScript", () => {
  it("preserves metadata exclusions when enabling a script", () => {
    const script = toRegisteredUserScript(record);
    expect(script.excludeMatches).toEqual(record.meta.excludeMatches);
    expect(script.excludeGlobs).toEqual(record.meta.excludeGlobs);
  });
});

describe("registration I/O", () => {
  it("skips updates for an unchanged enabled script", async () => {
    const get = vi.fn().mockResolvedValue({ settings: { enabled: true } });
    const update = vi.fn();
    const register = vi.fn();
    vi.stubGlobal("chrome", {
      runtime: {},
      storage: { local: { get } },
      userScripts: {
        getScripts: vi.fn().mockResolvedValue([toRegisteredUserScript(record)]),
        update,
        register,
      },
    });

    await expect(syncScriptRegistration(record)).resolves.toBeNull();
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("settings");
    expect(update).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });

  it("unregisters a disabled script without reading settings or source", async () => {
    const get = vi.fn();
    const unregister = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("chrome", {
      runtime: {},
      storage: { local: { get } },
      userScripts: { unregister },
    });

    await expect(syncScriptRegistration({ ...record, status: "disabled" })).resolves.toBeNull();
    expect(unregister).toHaveBeenCalledWith({ ids: [record.id] });
    expect(get).not.toHaveBeenCalled();
  });

  it("does not load disabled script sources during reconciliation", async () => {
    const get = vi.fn(async (keys: string | string[]) => {
      if (keys === "settings") return { settings: { enabled: true } };
      if (keys === "scriptIndex")
        return {
          scriptIndex: [
            { id: record.id, name: "x", status: "enabled", position: 0 },
            { id: "disabled", name: "off", status: "disabled", position: 1 },
          ],
        };
      return { [`script:${record.id}`]: record };
    });
    const register = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("chrome", {
      runtime: {},
      storage: { local: { get } },
      userScripts: {
        getScripts: vi.fn().mockResolvedValue([]),
        register,
      },
    });

    await reconcileRegistrations();
    expect(get).toHaveBeenCalledTimes(3);
    expect(get).toHaveBeenLastCalledWith([`script:${record.id}`]);
    expect(register).toHaveBeenCalledWith([toRegisteredUserScript(record)]);
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
