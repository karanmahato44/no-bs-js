import { afterEach, describe, expect, it, vi } from "vitest";

import type { ScriptId, UserScriptRecord } from "../domain/types";
import { setScriptEnabled } from "./script-actions";
import { getScript, listScriptIndex, migrateSiteOverrides, onScriptsChanged } from "./storage";

const record = (id: string, position = 0): UserScriptRecord => ({
  id: id as ScriptId,
  source: `console.log('${id}');`,
  meta: {
    name: id,
    matches: ["https://example.com/*"],
    excludeMatches: [],
    includeGlobs: [],
    excludeGlobs: [],
    runAt: "document_idle",
  },
  status: "enabled",
  position,
});

const setup = (records = [record("one")], extra: Record<string, unknown> = {}) => {
  const data: Record<string, unknown> = {
    scriptIndex: records.map(({ id, meta, status, position }) => ({
      id,
      name: meta.name,
      status,
      position,
    })),
    ...Object.fromEntries(records.map((item) => [`script:${item.id}`, item])),
    ...extra,
  };
  const listeners: Array<
    (changes: Record<string, chrome.storage.StorageChange>, area: string) => void
  > = [];
  const emit = (changes: Record<string, chrome.storage.StorageChange>, area = "local") => {
    for (const listener of listeners) listener(changes, area);
  };
  const get = vi.fn(async (keys: string | string[]) =>
    structuredClone(
      Object.fromEntries((typeof keys === "string" ? [keys] : keys).map((key) => [key, data[key]])),
    ),
  );
  const set = vi.fn(async (updates: Record<string, unknown>) => {
    const changes: Record<string, chrome.storage.StorageChange> = {};
    for (const [key, value] of Object.entries(updates)) {
      changes[key] = { oldValue: data[key], newValue: structuredClone(value) };
      data[key] = structuredClone(value);
    }
    emit(changes);
  });
  const remove = vi.fn(async (keys: string | string[]) => {
    for (const key of typeof keys === "string" ? [keys] : keys) delete data[key];
  });
  const registrations = new Map<string, chrome.userScripts.RegisteredUserScript>();
  const userScripts = {
    getScripts: vi.fn(async ({ ids }: { ids: string[] }) =>
      ids.flatMap((id) => registrations.get(id) ?? []),
    ),
    register: vi.fn(async (scripts: chrome.userScripts.RegisteredUserScript[]) => {
      for (const script of scripts) registrations.set(script.id, script);
    }),
    update: vi.fn(async (scripts: chrome.userScripts.RegisteredUserScript[]) => {
      for (const script of scripts) registrations.set(script.id, script);
    }),
    unregister: vi.fn(async ({ ids }: { ids: string[] }) => {
      for (const id of ids) registrations.delete(id);
    }),
  };
  let queue: Promise<unknown> = Promise.resolve();
  const request = vi.fn((_name: string, action: () => Promise<unknown>) => {
    const result = queue.then(action);
    queue = result.catch(() => {});
    return result;
  });
  vi.stubGlobal("navigator", { locks: { request } });
  vi.stubGlobal("chrome", {
    runtime: {},
    userScripts,
    storage: {
      local: { get, set, remove },
      onChanged: {
        addListener: (listener: (typeof listeners)[number]) => listeners.push(listener),
      },
    },
  });
  return { data, get, set, remove, emit, registrations, userScripts, request };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("shared script toggles", () => {
  it("broadcasts the same status to both views without extra reads", async () => {
    const { get, set, registrations } = setup();
    const popup = vi.fn();
    const options = vi.fn();
    onScriptsChanged(popup);
    onScriptsChanged(options);

    await setScriptEnabled("one" as ScriptId, false);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith(["script:one", "scriptIndex"]);
    expect(set).toHaveBeenCalledTimes(1);
    const update = popup.mock.calls[0]?.[0];
    expect(update.index[0].status).toBe("disabled");
    expect(update.records.get("one").status).toBe("disabled");
    expect(options.mock.calls[0]?.[0]).toEqual(update);

    await setScriptEnabled("one" as ScriptId, true);
    expect(registrations.has("one")).toBe(true);
    expect(popup.mock.calls[1]?.[0]).toEqual(options.mock.calls[1]?.[0]);
    expect((await getScript("one" as ScriptId))?.status).toBe("enabled");
  });

  it("keeps both records and index consistent during simultaneous toggles", async () => {
    setup([record("one"), record("two", 1)]);
    await Promise.all([
      setScriptEnabled("one" as ScriptId, false),
      setScriptEnabled("two" as ScriptId, false),
    ]);
    expect((await listScriptIndex()).map(({ status }) => status)).toEqual(["disabled", "disabled"]);
    expect((await getScript("one" as ScriptId))?.status).toBe("disabled");
    expect((await getScript("two" as ScriptId))?.status).toBe("disabled");
  });

  it("applies rapid opposite toggles in order through registration completion", async () => {
    const { registrations } = setup();
    await Promise.all([
      setScriptEnabled("one" as ScriptId, false),
      setScriptEnabled("one" as ScriptId, true),
      setScriptEnabled("one" as ScriptId, false),
    ]);
    expect(registrations.has("one")).toBe(false);
    expect((await getScript("one" as ScriptId))?.status).toBe("disabled");
    expect((await listScriptIndex())[0]?.status).toBe("disabled");
  });

  it("does not register an enabled script while the extension is disabled", async () => {
    const { registrations, userScripts } = setup([{ ...record("one"), status: "disabled" }], {
      settings: { enabled: false },
    });
    await setScriptEnabled("one" as ScriptId, true);
    expect((await getScript("one" as ScriptId))?.status).toBe("enabled");
    expect(registrations.size).toBe(0);
    expect(userScripts.register).not.toHaveBeenCalled();
  });

  it("does not rewrite unchanged status or registration", async () => {
    const { set, userScripts } = setup();
    await setScriptEnabled("one" as ScriptId, true);
    await setScriptEnabled("one" as ScriptId, true);
    expect(set).not.toHaveBeenCalled();
    expect(userScripts.register).toHaveBeenCalledTimes(1);
    expect(userScripts.update).not.toHaveBeenCalled();
  });

  it("repairs a stale index even when the record already has the requested status", async () => {
    setup([{ ...record("one"), status: "disabled" }], {
      scriptIndex: [{ id: "one", name: "one", status: "enabled", position: 0 }],
    });
    await setScriptEnabled("one" as ScriptId, false);
    expect((await listScriptIndex())[0]?.status).toBe("disabled");
  });

  it("releases the mutation lock after a failed registration", async () => {
    const { userScripts } = setup();
    userScripts.unregister.mockRejectedValueOnce(new Error("registration failed"));
    await expect(setScriptEnabled("one" as ScriptId, false)).rejects.toThrow("registration failed");
    await expect(setScriptEnabled("one" as ScriptId, true)).resolves.toBeUndefined();
    expect((await listScriptIndex())[0]?.status).toBe("enabled");
  });
});

describe("storage notifications and migration", () => {
  it("ignores session and unrelated storage events", () => {
    const { emit, get } = setup();
    const handler = vi.fn();
    onScriptsChanged(handler);
    emit({ scriptIndex: { newValue: [] } }, "session");
    emit({ unrelated: { newValue: true } });
    expect(handler).not.toHaveBeenCalled();
    emit({ settings: { newValue: { enabled: false } } });
    expect(handler.mock.calls[0]?.[0].enabled).toBe(false);
    expect(get).not.toHaveBeenCalled();
  });

  it("migrates previous site disables once and keeps all other scripts unchanged", async () => {
    const { data, set, remove } = setup(
      [record("one"), record("two", 1), { ...record("three", 2), status: "disabled" }],
      {
        siteDisabledHosts: { one: ["example.com"], missing: ["gone.com"] },
        siteEnabledHosts: { two: ["example.com"], three: ["example.com"] },
      },
    );
    await migrateSiteOverrides();
    expect((await listScriptIndex()).map(({ status }) => status)).toEqual([
      "disabled",
      "enabled",
      "disabled",
    ]);
    expect((await getScript("one" as ScriptId))?.status).toBe("disabled");
    expect(data["siteDisabledHosts"]).toBeUndefined();
    expect(data["siteEnabledHosts"]).toBeUndefined();
    await migrateSiteOverrides();
    expect(set).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
