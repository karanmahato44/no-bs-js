import { expandMatchPatterns, matchChromePattern, matchGlob } from "../domain/url-match";
import type { UserScriptRecord } from "../domain/types";
import {
  getExtensionEnabled,
  getScriptHostLists,
  getScripts,
  getScriptsHostLists,
  listScriptIndex,
  type ScriptHostLists,
} from "./storage";

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
  const script = toRegisteredUserScript(record, hostLists);

  if (existing.length > 0) {
    await chrome.userScripts.update([script]);
  } else {
    await chrome.userScripts.register([script]);
  }

  return runtimeError();
};

export const toRegisteredUserScript = (
  record: UserScriptRecord,
  { disabledHosts, enabledHosts }: ScriptHostLists,
): chrome.userScripts.RegisteredUserScript => {
  const excludeMatches =
    enabledHosts.length === 0
      ? [...record.meta.excludeMatches]
      : record.meta.excludeMatches.filter(
          (pattern) => !enabledHosts.some((host) => hostMatchesPattern(host, pattern)),
        );
  const excludeGlobs =
    enabledHosts.length === 0
      ? [...record.meta.excludeGlobs]
      : record.meta.excludeGlobs.filter(
          (glob) => !enabledHosts.some((host) => hostMatchesGlob(host, glob)),
        );

  for (const host of disabledHosts) {
    const match = hostExcludeMatch(host);
    if (match === null) {
      excludeGlobs.push(hostExcludeGlob(host));
    } else {
      excludeMatches.push(match);
    }
  }

  return {
    id: record.id,
    matches: expandMatchPatterns(record.meta.matches),
    excludeMatches,
    includeGlobs: [...record.meta.includeGlobs],
    excludeGlobs,
    runAt: record.meta.runAt,
    js: [{ code: record.source }],
  };
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

  const [extensionEnabled, index, existing] = await Promise.all([
    getExtensionEnabled(),
    listScriptIndex(),
    chrome.userScripts.getScripts(),
  ]);
  const records = extensionEnabled
    ? (await getScripts(index.map((item) => item.id))).filter(
        (record): record is UserScriptRecord => record !== null && record.status === "enabled",
      )
    : [];
  const hostLists = await getScriptsHostLists(records.map((record) => record.id));
  const desired = records.map((record, index) =>
    toRegisteredUserScript(record, hostLists[index] as ScriptHostLists),
  );

  await applyRegistrationPlan(createRegistrationPlan(existing, desired));

  return runtimeError();
};

type RegistrationPlan = {
  unregisterIds: string[];
  updates: chrome.userScripts.RegisteredUserScript[];
  registrations: chrome.userScripts.RegisteredUserScript[];
};

export const createRegistrationPlan = (
  existing: readonly chrome.userScripts.RegisteredUserScript[],
  desired: readonly chrome.userScripts.RegisteredUserScript[],
): RegistrationPlan => {
  const desiredById = new Map(desired.map((script) => [script.id, script]));
  const unregisterIds: string[] = [];
  const updates: chrome.userScripts.RegisteredUserScript[] = [];

  for (const script of existing) {
    const next = desiredById.get(script.id);
    if (next === undefined) {
      unregisterIds.push(script.id);
    } else {
      if (!sameRegistration(script, next)) {
        updates.push(next);
      }
      desiredById.delete(script.id);
    }
  }

  return { unregisterIds, updates, registrations: [...desiredById.values()] };
};

const sameRegistration = (
  left: chrome.userScripts.RegisteredUserScript,
  right: chrome.userScripts.RegisteredUserScript,
): boolean =>
  left.runAt === right.runAt &&
  sameStrings(left.matches, right.matches) &&
  sameStrings(left.excludeMatches, right.excludeMatches) &&
  sameStrings(left.includeGlobs, right.includeGlobs) &&
  sameStrings(left.excludeGlobs, right.excludeGlobs) &&
  sameSources(left.js, right.js);

const sameStrings = (left: readonly string[] | undefined, right: readonly string[] | undefined) => {
  const leftLength = left?.length ?? 0;
  if (leftLength !== (right?.length ?? 0)) {
    return false;
  }

  for (let index = 0; index < leftLength; index += 1) {
    if (left?.[index] !== right?.[index]) {
      return false;
    }
  }
  return true;
};

const sameSources = (
  left: readonly chrome.userScripts.ScriptSource[] | undefined,
  right: readonly chrome.userScripts.ScriptSource[] | undefined,
): boolean => {
  const leftLength = left?.length ?? 0;
  if (leftLength !== (right?.length ?? 0)) {
    return false;
  }

  for (let index = 0; index < leftLength; index += 1) {
    const leftSource = left?.[index];
    const rightSource = right?.[index];
    if (leftSource?.code !== rightSource?.code || leftSource?.file !== rightSource?.file) {
      return false;
    }
  }
  return true;
};

const applyRegistrationPlan = async (plan: RegistrationPlan): Promise<void> => {
  const operations: Array<Promise<void>> = [];
  if (plan.unregisterIds.length > 0) {
    operations.push(chrome.userScripts.unregister({ ids: plan.unregisterIds }));
  }
  if (plan.updates.length > 0) {
    operations.push(chrome.userScripts.update(plan.updates));
  }
  if (plan.registrations.length > 0) {
    operations.push(chrome.userScripts.register(plan.registrations));
  }
  await Promise.all(operations);
};

const runtimeError = (): RegistrationError | null => {
  const message = chrome.runtime.lastError?.message;
  return message === undefined ? null : { kind: "chrome_runtime_error", message };
};

const hostExcludeMatch = (host: string): string | null => {
  if (host.includes(":")) {
    return null;
  }

  return `*://${host}/*`;
};

const hostExcludeGlob = (host: string): string => `*://${host}/*`;

const hostMatchesPattern = (host: string, pattern: string): boolean =>
  matchChromePattern(pattern, `https://${host}/`) || matchChromePattern(pattern, `http://${host}/`);

const hostMatchesGlob = (host: string, glob: string): boolean =>
  matchGlob(glob, `https://${host}/`) || matchGlob(glob, `http://${host}/`);
