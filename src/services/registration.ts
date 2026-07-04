import { expandMatchPatterns, matchChromePattern, matchGlob } from "../domain/url-match";
import { listScriptIndex, getScript, getExtensionEnabled, getScriptHostLists } from "./storage";
import type { UserScriptRecord } from "../domain/types";

export type RegistrationError = {
  kind: "user_scripts_unavailable" | "chrome_runtime_error";
  message: string;
};

type SyncRegistrationOptions = {
  extensionEnabled?: boolean;
};

export const userScriptsAvailable = (): boolean =>
  typeof chrome !== "undefined" && chrome.userScripts !== undefined;

export const syncScriptRegistration = async (
  record: UserScriptRecord,
  options: SyncRegistrationOptions = {},
): Promise<RegistrationError | null> => {
  if (!userScriptsAvailable()) {
    return {
      kind: "user_scripts_unavailable",
      message:
        "chrome.userScripts unavailable. enable user scripts/developer mode in this browser.",
    };
  }

  if (record.status === "disabled") {
    await chrome.userScripts.unregister({ ids: [record.id] });
    return runtimeError();
  }

  if (!(options.extensionEnabled ?? (await getExtensionEnabled()))) {
    await chrome.userScripts.unregister({ ids: [record.id] });
    return runtimeError();
  }

  const [existing, hostLists] = await Promise.all([
    chrome.userScripts.getScripts({ ids: [record.id] }),
    getScriptHostLists(record.id),
  ]);
  const { disabledHosts, enabledHosts } = hostLists;
  const script: chrome.userScripts.RegisteredUserScript = {
    id: record.id,
    matches: expandMatchPatterns(record.meta.matches),
    excludeMatches: record.meta.excludeMatches.filter(
      (pattern) => !enabledHosts.some((host) => hostMatchesPattern(host, pattern)),
    ),
    includeGlobs: [...record.meta.includeGlobs],
    excludeGlobs: [
      ...record.meta.excludeGlobs.filter(
        (glob) => !enabledHosts.some((host) => hostMatchesGlob(host, glob)),
      ),
      ...disabledHosts.map(hostExcludeGlob),
    ],
    runAt: record.meta.runAt,
    js: [{ code: record.source }],
  };

  if (existing.length > 0) {
    await chrome.userScripts.update([script]);
  } else {
    await chrome.userScripts.register([script]);
  }

  return runtimeError();
};

export const unregisterScript = async (id: string): Promise<RegistrationError | null> => {
  if (!userScriptsAvailable()) {
    return {
      kind: "user_scripts_unavailable",
      message:
        "chrome.userScripts unavailable. enable user scripts/developer mode in this browser.",
    };
  }

  await chrome.userScripts.unregister({ ids: [id] });
  return runtimeError();
};

export const reconcileRegistrations = async (): Promise<RegistrationError | null> => {
  if (!userScriptsAvailable()) {
    return null;
  }

  const extensionEnabled = await getExtensionEnabled();
  if (!extensionEnabled) {
    const existing = await chrome.userScripts.getScripts();
    const ids = existing.map((script) => script.id);
    if (ids.length > 0) {
      await chrome.userScripts.unregister({ ids });
    }
    return runtimeError();
  }

  const [index, existing] = await Promise.all([listScriptIndex(), chrome.userScripts.getScripts()]);
  const knownIds = new Set<string>(index.map((item) => item.id));
  const staleIds = existing.map((script) => script.id).filter((id) => !knownIds.has(id));

  if (staleIds.length > 0) {
    await chrome.userScripts.unregister({ ids: staleIds });
  }

  const records = await Promise.all(index.map((item) => getScript(item.id)));
  for (const record of records) {
    if (record !== null) {
      const error = await syncScriptRegistration(record, { extensionEnabled });
      if (error !== null) {
        return error;
      }
    }
  }

  return runtimeError();
};

const runtimeError = (): RegistrationError | null => {
  const message = chrome.runtime.lastError?.message;
  return message === undefined ? null : { kind: "chrome_runtime_error", message };
};

const hostExcludeGlob = (host: string): string => `*://${host}/*`;

const hostMatchesPattern = (host: string, pattern: string): boolean =>
  matchChromePattern(pattern, `https://${host}/`) || matchChromePattern(pattern, `http://${host}/`);

const hostMatchesGlob = (host: string, glob: string): boolean =>
  matchGlob(glob, `https://${host}/`) || matchGlob(glob, `http://${host}/`);
