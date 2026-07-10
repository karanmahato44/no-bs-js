import "./style.css";

import { describeError } from "../domain/error-message";
import { scriptMatchesUrl } from "../domain/url-match";
import type { ScriptId, UserScriptRecord } from "../domain/types";
import { reconcileRegistrations, syncScriptRegistration } from "../services/registration";
import {
  getExtensionEnabled,
  getScriptHostOverrides,
  getScripts,
  listScriptIndex,
  setExtensionEnabled,
  setPendingOptionsScriptId,
  setScriptHostOverride,
} from "../services/storage";

const elements = {
  openOptions: byId<HTMLButtonElement>("openOptions"),
  globalToggle: byId<HTMLInputElement>("globalToggle"),
  status: byId<HTMLElement>("status"),
  scripts: byId<HTMLElement>("scripts"),
};

const boot = async (): Promise<void> => {
  elements.openOptions.addEventListener("click", () => {
    void runAction(async () => {
      await chrome.runtime.openOptionsPage();
      window.close();
    });
  });
  elements.globalToggle.addEventListener("change", () => {
    void runAction(handleGlobalToggle);
  });
  elements.globalToggle.checked = await getExtensionEnabled();

  const tabUrl = await getActiveTabUrl();
  if (tabUrl === null) {
    clearStatus();
    return;
  }

  const host = hostLabel(tabUrl);
  await renderScripts(tabUrl, host);
};

const handleGlobalToggle = async (): Promise<void> => {
  await setExtensionEnabled(elements.globalToggle.checked);
  const error = await reconcileRegistrations();
  if (error !== null) {
    showStatus(error.message);
  }
  await bootRowsOnly();
};

const bootRowsOnly = async (): Promise<void> => {
  const tabUrl = await getActiveTabUrl();
  if (tabUrl === null) {
    clearStatus();
    return;
  }

  await renderScripts(tabUrl, hostLabel(tabUrl));
};

const renderScripts = async (url: string, host: string): Promise<void> => {
  const index = await listScriptIndex();
  const enabledIndex = index.filter((item) => item.status === "enabled");
  const [records, hostOverrides] = await Promise.all([
    getScripts(enabledIndex.map((item) => item.id)),
    getScriptHostOverrides(host),
  ]);
  const matches = records
    .filter((record): record is UserScriptRecord => record !== null)
    .filter((record) => scriptMatchesUrl(record.meta, url))
    .map((record) => ({
      record,
      siteEnabled: getSiteEnabled(record, hostOverrides),
    }));

  if (matches.length === 0) {
    clearStatus();
    elements.scripts.replaceChildren();
    return;
  }

  elements.status.hidden = true;
  elements.scripts.replaceChildren(
    ...matches.map((item) => renderScriptRow(item.record, host, item.siteEnabled)),
  );
};

const renderScriptRow = (
  record: UserScriptRecord,
  host: string,
  siteEnabled: boolean,
): HTMLElement => {
  const row = document.createElement("div");
  row.className = "script-row";

  const name = document.createElement("span");
  name.textContent = record.meta.name;

  const edit = document.createElement("button");
  edit.type = "button";
  edit.textContent = "</>";
  edit.title = `edit ${record.meta.name}`;
  edit.addEventListener("click", () => {
    void runAction(() => openScriptOptions(record.id));
  });

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = siteEnabled;
  input.disabled = !elements.globalToggle.checked;
  input.addEventListener("change", () => {
    void runAction(() => toggleScript(record, host, input.checked));
  });

  row.append(name, edit, input);
  return row;
};

const openScriptOptions = async (id: ScriptId): Promise<void> => {
  await setPendingOptionsScriptId(id);
  await chrome.runtime.openOptionsPage();
  window.close();
};

const toggleScript = async (
  record: UserScriptRecord,
  host: string,
  enabledForSite: boolean,
): Promise<void> => {
  await setScriptHostOverride(record.id, host, enabledForSite);
  const error = await syncScriptRegistration(record);
  if (error !== null) {
    showStatus(error.message);
  }
};

const getSiteEnabled = (
  record: UserScriptRecord,
  overrides: ReadonlyMap<string, boolean>,
): boolean => overrides.get(record.id) ?? true;

const getActiveTabUrl = async (): Promise<string | null> => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.url ?? null;
};

const hostLabel = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

const showStatus = (message: string): void => {
  elements.status.hidden = false;
  elements.status.textContent = message;
};

const clearStatus = (): void => {
  elements.status.hidden = true;
  elements.status.textContent = "";
};

const runAction = async (action: () => void | Promise<void>): Promise<void> => {
  clearStatus();
  try {
    await action();
  } catch (error) {
    showStatus(describeError(error));
  }
};

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`missing element #${id}`);
  }
  return element as T;
}

void boot().catch((error: unknown) => {
  showStatus(describeError(error));
});
