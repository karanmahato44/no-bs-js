import type { ScriptId, ScriptIndexItem, ScriptStatus, UserScriptRecord } from "../domain/types";

const indexKey = "scriptIndex";
const siteDisabledKey = "siteDisabledHosts";
const siteEnabledKey = "siteEnabledHosts";
const pendingOptionsScriptKey = "pendingOptionsScriptId";
const settingsKey = "settings";
const scriptKey = (id: ScriptId): string => `script:${id}`;

type ScriptStorageChanges = {
  index?: ScriptIndexItem[];
  enabled?: boolean;
  records: Map<ScriptId, UserScriptRecord | null>;
};

export const onScriptsChanged = (handler: (changes: ScriptStorageChanges) => void): void => {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }

    const update: ScriptStorageChanges = { records: new Map() };
    if (changes[indexKey] !== undefined) {
      update.index = decodeScriptIndex(changes[indexKey].newValue);
    }
    if (changes[settingsKey] !== undefined) {
      update.enabled = decodeExtensionEnabled(changes[settingsKey].newValue);
    }
    for (const [key, change] of Object.entries(changes)) {
      if (key.startsWith("script:")) {
        update.records.set(key.slice(7) as ScriptId, decodeScriptRecord(change.newValue));
      }
    }
    if (update.index !== undefined || update.enabled !== undefined || update.records.size > 0) {
      handler(update);
    }
  });
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

export const getScripts = async (
  ids: readonly ScriptId[],
): Promise<Array<UserScriptRecord | null>> => {
  if (ids.length === 0) {
    return [];
  }

  const result = await chrome.storage.local.get(ids.map(scriptKey));
  return ids.map((id) => decodeScriptRecord(result[scriptKey(id)]));
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
  const index = await listScriptIndex();
  await chrome.storage.local.remove(scriptKey(id));
  await chrome.storage.local.set({
    [indexKey]: index.filter((item) => item.id !== id),
  });
};

export const updateScriptStatus = async (
  id: ScriptId,
  status: ScriptStatus,
): Promise<UserScriptRecord | null> => {
  const result = await chrome.storage.local.get([scriptKey(id), indexKey]);
  const record = decodeScriptRecord(result[scriptKey(id)]);
  if (record === null) {
    return null;
  }

  const index = decodeScriptIndex(result[indexKey]);
  const item = index.find((entry) => entry.id === id);
  if (record.status === status && item?.status === status) {
    return record;
  }

  const updated: UserScriptRecord = { ...record, status };
  if (item === undefined) {
    index.push(toIndexItem(updated));
    index.sort((left, right) => left.position - right.position);
  } else {
    item.status = status;
  }
  await chrome.storage.local.set({
    [scriptKey(id)]: updated,
    [indexKey]: index,
  });
  return updated;
};

export const getExtensionEnabled = async (): Promise<boolean> => {
  const result = await chrome.storage.local.get(settingsKey);
  return decodeExtensionEnabled(result[settingsKey]);
};

const decodeExtensionEnabled = (settings: unknown): boolean => {
  if (!isObject(settings) || typeof settings["enabled"] !== "boolean") {
    return true;
  }
  return settings["enabled"];
};

export const setExtensionEnabled = async (enabled: boolean): Promise<void> => {
  const result = await chrome.storage.local.get(settingsKey);
  const settings = isObject(result[settingsKey]) ? result[settingsKey] : {};
  if (decodeExtensionEnabled(settings) !== enabled) {
    await chrome.storage.local.set({ [settingsKey]: { ...settings, enabled } });
  }
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

export const migrateSiteOverrides = async (): Promise<void> => {
  const result = await chrome.storage.local.get([siteDisabledKey, siteEnabledKey]);
  if (result[siteDisabledKey] === undefined && result[siteEnabledKey] === undefined) {
    return;
  }

  // Preserve previous opt-outs when replacing site overrides with one script status.
  const disabled = result[siteDisabledKey];
  if (isObject(disabled)) {
    const ids = Object.entries(disabled)
      .filter(([, hosts]) => isStringArray(hosts) && hosts.length > 0)
      .map(([id]) => id as ScriptId);
    const records = await getScripts(ids);
    await saveScripts(
      records
        .filter(
          (record): record is UserScriptRecord => record !== null && record.status === "enabled",
        )
        .map((record) => ({ ...record, status: "disabled" })),
    );
  }
  await chrome.storage.local.remove([siteDisabledKey, siteEnabledKey]);
};

const toIndexItem = (record: UserScriptRecord): ScriptIndexItem => ({
  id: record.id,
  name: record.meta.name,
  status: record.status,
  position: record.position,
});

const decodeScriptIndex = (value: unknown): ScriptIndexItem[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isScriptIndexItem)
    .map((item) => ({
      id: item.id,
      name: item.name,
      status: item.status,
      position: item.position,
    }))
    .sort((left, right) => left.position - right.position);
};

const decodeScriptRecord = (value: unknown): UserScriptRecord | null => {
  if (!isScriptRecord(value)) {
    return null;
  }

  return {
    id: value.id,
    source: value.source,
    meta: {
      name: value.meta.name,
      matches: value.meta.matches,
      excludeMatches: value.meta.excludeMatches,
      includeGlobs: value.meta.includeGlobs,
      excludeGlobs: value.meta.excludeGlobs,
      runAt: value.meta.runAt,
    },
    status: value.status,
    position: value.position,
  };
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isScriptIndexItem = (value: unknown): value is ScriptIndexItem => {
  if (!isObject(value)) {
    return false;
  }

  return (
    typeof value["id"] === "string" &&
    typeof value["name"] === "string" &&
    (value["status"] === "enabled" || value["status"] === "disabled") &&
    typeof value["position"] === "number"
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
    typeof value["source"] === "string" &&
    (value["status"] === "enabled" || value["status"] === "disabled") &&
    typeof value["position"] === "number" &&
    typeof meta["name"] === "string" &&
    isStringArray(meta["matches"]) &&
    isStringArray(meta["excludeMatches"]) &&
    isStringArray(meta["includeGlobs"]) &&
    isStringArray(meta["excludeGlobs"]) &&
    (meta["runAt"] === "document_start" ||
      meta["runAt"] === "document_end" ||
      meta["runAt"] === "document_idle")
  );
};
