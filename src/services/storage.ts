import type { ScriptId, ScriptIndexItem, ScriptStatus, UserScriptRecord } from "../domain/types";

const indexKey = "scriptIndex";
const siteDisabledKey = "siteDisabledHosts";
const siteEnabledKey = "siteEnabledHosts";
const pendingOptionsScriptKey = "pendingOptionsScriptId";
const settingsKey = "settings";
const scriptKey = (id: ScriptId): string => `script:${id}`;

type SiteHostOverrides = {
  disabled: Record<string, string[]>;
  enabled: Record<string, string[]>;
};

export const listScriptIndex = async (): Promise<ScriptIndexItem[]> => {
  const result = await chrome.storage.local.get(indexKey);
  const value = result[indexKey];
  return decodeScriptIndex(value);
};

export const getScript = async (id: ScriptId): Promise<UserScriptRecord | null> => {
  const result = await chrome.storage.local.get(scriptKey(id));
  return decodeScriptRecord(result[scriptKey(id)]);
};

export const saveScript = async (record: UserScriptRecord): Promise<void> => {
  await saveScripts([record]);
};

export const saveScripts = async (records: readonly UserScriptRecord[]): Promise<void> => {
  if (records.length === 0) {
    return;
  }

  const index = await listScriptIndex();
  const ids = new Set<ScriptId>();
  for (const record of records) {
    ids.add(record.id);
  }

  const nextIndex = index.filter((item) => !ids.has(item.id));
  const updates: Record<string, UserScriptRecord | ScriptIndexItem[]> = {};

  for (const record of records) {
    updates[scriptKey(record.id)] = record;
    nextIndex.push(toIndexItem(record));
  }

  nextIndex.sort((left, right) => left.position - right.position);
  updates[indexKey] = nextIndex;
  await chrome.storage.local.set(updates);
};

export const deleteScript = async (id: ScriptId): Promise<void> => {
  const [index, hostOverrides] = await Promise.all([listScriptIndex(), getSiteHostOverrides()]);
  delete hostOverrides.disabled[id];
  delete hostOverrides.enabled[id];
  await chrome.storage.local.remove(scriptKey(id));
  await chrome.storage.local.set({
    [indexKey]: index.filter((item) => item.id !== id),
    [siteDisabledKey]: hostOverrides.disabled,
    [siteEnabledKey]: hostOverrides.enabled,
  });
};

export const updateScriptStatus = async (
  id: ScriptId,
  status: ScriptStatus,
): Promise<UserScriptRecord | null> => {
  const record = await getScript(id);
  if (record === null) {
    return null;
  }

  const updated: UserScriptRecord = { ...record, status, updatedAt: Date.now() };
  await saveScript(updated);
  return updated;
};

export const getExtensionEnabled = async (): Promise<boolean> => {
  const result = await chrome.storage.local.get(settingsKey);
  const settings = result[settingsKey];
  if (!isObject(settings) || typeof settings["enabled"] !== "boolean") {
    return true;
  }
  return settings["enabled"];
};

export const setExtensionEnabled = async (enabled: boolean): Promise<void> => {
  const result = await chrome.storage.local.get(settingsKey);
  const settings = isObject(result[settingsKey]) ? result[settingsKey] : {};
  await chrome.storage.local.set({ [settingsKey]: { ...settings, enabled } });
};

export const setPendingOptionsScriptId = async (id: ScriptId): Promise<void> => {
  await chrome.storage.session.set({ [pendingOptionsScriptKey]: id });
};

export const takePendingOptionsScriptId = async (): Promise<ScriptId | null> => {
  const result = await chrome.storage.session.get(pendingOptionsScriptKey);
  const value = result[pendingOptionsScriptKey];
  if (typeof value !== "string") {
    return null;
  }

  await chrome.storage.session.remove(pendingOptionsScriptKey);
  return value as ScriptId;
};

export const onPendingOptionsScriptId = (handler: () => void): void => {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "session" && typeof changes[pendingOptionsScriptKey]?.newValue === "string") {
      handler();
    }
  });
};

export const getScriptHostLists = async (
  id: ScriptId,
): Promise<{ disabledHosts: string[]; enabledHosts: string[] }> => {
  const hostOverrides = await getSiteHostOverrides();
  return {
    disabledHosts: hostOverrides.disabled[id] ?? [],
    enabledHosts: hostOverrides.enabled[id] ?? [],
  };
};

export const getScriptHostOverrides = async (host: string): Promise<Map<ScriptId, boolean>> => {
  const hostOverrides = await getSiteHostOverrides();
  const overrides = new Map<ScriptId, boolean>();
  addHostOverrides(overrides, hostOverrides.disabled, host, false);
  addHostOverrides(overrides, hostOverrides.enabled, host, true);
  return overrides;
};

export const setScriptHostOverride = async (
  id: ScriptId,
  host: string,
  enabled: boolean,
): Promise<void> => {
  const hostOverrides = await getSiteHostOverrides();
  const disabledOverrides = hostOverrides.disabled;
  const enabledOverrides = hostOverrides.enabled;
  const disabledHosts = new Set(disabledOverrides[id] ?? []);
  const enabledHosts = new Set(enabledOverrides[id] ?? []);

  if (enabled) {
    enabledHosts.add(host);
    disabledHosts.delete(host);
  } else {
    disabledHosts.add(host);
    enabledHosts.delete(host);
  }

  const nextDisabled = { ...disabledOverrides, [id]: [...disabledHosts].sort() };
  if (nextDisabled[id]?.length === 0) {
    delete nextDisabled[id];
  }

  const nextEnabled = { ...enabledOverrides, [id]: [...enabledHosts].sort() };
  if (nextEnabled[id]?.length === 0) {
    delete nextEnabled[id];
  }

  await chrome.storage.local.set({
    [siteDisabledKey]: nextDisabled,
    [siteEnabledKey]: nextEnabled,
  });
};

const toIndexItem = (record: UserScriptRecord): ScriptIndexItem => ({
  id: record.id,
  name: record.meta.name,
  namespace: record.meta.namespace,
  status: record.status,
  position: record.position,
  updatedAt: record.updatedAt,
});

const getSiteHostOverrides = async (): Promise<SiteHostOverrides> => {
  const result = await chrome.storage.local.get([siteDisabledKey, siteEnabledKey]);
  return {
    disabled: decodeSiteDisabledHosts(result[siteDisabledKey]),
    enabled: decodeSiteDisabledHosts(result[siteEnabledKey]),
  };
};

const decodeSiteDisabledHosts = (value: unknown): Record<string, string[]> => {
  if (!isObject(value)) {
    return {};
  }

  const entries = Object.entries(value).filter(
    (entry): entry is [string, string[]] => typeof entry[0] === "string" && isStringArray(entry[1]),
  );
  return Object.fromEntries(entries);
};

const addHostOverrides = (
  result: Map<ScriptId, boolean>,
  overrides: Record<string, string[]>,
  host: string,
  enabled: boolean,
): void => {
  for (const [id, hosts] of Object.entries(overrides)) {
    if (hosts.includes(host)) {
      result.set(id as ScriptId, enabled);
    }
  }
};

const decodeScriptIndex = (value: unknown): ScriptIndexItem[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isScriptIndexItem).sort((left, right) => left.position - right.position);
};

const decodeScriptRecord = (value: unknown): UserScriptRecord | null =>
  isScriptRecord(value) ? value : null;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isScriptIndexItem = (value: unknown): value is ScriptIndexItem => {
  if (!isObject(value)) {
    return false;
  }

  return (
    typeof value["id"] === "string" &&
    typeof value["name"] === "string" &&
    (typeof value["namespace"] === "string" || value["namespace"] === null) &&
    (value["status"] === "enabled" || value["status"] === "disabled") &&
    typeof value["position"] === "number" &&
    typeof value["updatedAt"] === "number"
  );
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isScriptRecord = (value: unknown): value is UserScriptRecord => {
  if (!isObject(value) || !isObject(value["meta"])) {
    return false;
  }

  const meta = value["meta"];
  return (
    typeof value["id"] === "string" &&
    typeof value["sourceHash"] === "string" &&
    typeof value["source"] === "string" &&
    (value["status"] === "enabled" || value["status"] === "disabled") &&
    typeof value["position"] === "number" &&
    typeof value["createdAt"] === "number" &&
    typeof value["updatedAt"] === "number" &&
    typeof meta["name"] === "string" &&
    (typeof meta["namespace"] === "string" || meta["namespace"] === null) &&
    (typeof meta["version"] === "string" || meta["version"] === null) &&
    (typeof meta["description"] === "string" || meta["description"] === null) &&
    isStringArray(meta["matches"]) &&
    isStringArray(meta["excludeMatches"]) &&
    isStringArray(meta["includeGlobs"]) &&
    isStringArray(meta["excludeGlobs"]) &&
    isStringArray(meta["grants"]) &&
    (meta["runAt"] === "document_start" ||
      meta["runAt"] === "document_end" ||
      meta["runAt"] === "document_idle")
  );
};
