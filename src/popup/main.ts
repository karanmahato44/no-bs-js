import "./style.css";

import { describeError } from "../domain/error-message";
import { scriptMatchesUrl } from "../domain/url-match";
import type { ScriptId, ScriptIndexItem } from "../domain/types";
import { reconcileRegistrations } from "../services/registration";
import { setScriptEnabled, withScriptMutation } from "../services/script-actions";
import {
  getExtensionEnabled,
  getScript,
  getScripts,
  listScriptIndex,
  onScriptsChanged,
  setExtensionEnabled,
  setPendingOptionsScriptId,
} from "../services/storage";

const elements = {
  openOptions: byId<HTMLButtonElement>("openOptions"),
  globalToggle: byId<HTMLInputElement>("globalToggle"),
  status: byId<HTMLElement>("status"),
  scripts: byId<HTMLElement>("scripts"),
};

type ScriptRow = {
  element: HTMLElement;
  name: HTMLElement;
  edit: HTMLButtonElement;
  toggle: HTMLInputElement;
  pending: boolean;
};

const rows = new Map<ScriptId, ScriptRow>();
const matchingIds = new Set<ScriptId>();
let scriptIndex: readonly ScriptIndexItem[] = [];

const boot = async (): Promise<void> => {
  elements.globalToggle.disabled = true;
  elements.openOptions.addEventListener("click", () => {
    void runAction(async () => {
      await chrome.runtime.openOptionsPage();
      window.close();
    });
  });
  elements.globalToggle.addEventListener("change", () => {
    void runAction(handleGlobalToggle);
  });

  let revision = 0;
  let ready = false;
  let tabUrl: string | null = null;
  onScriptsChanged((changes) => {
    revision += 1;
    if (!ready) {
      return;
    }
    if (changes.enabled !== undefined) {
      elements.globalToggle.checked = changes.enabled;
    }
    if (changes.index !== undefined) {
      scriptIndex = changes.index;
    }
    for (const [id, record] of changes.records) {
      if (record !== null && tabUrl !== null && scriptMatchesUrl(record.meta, tabUrl)) {
        matchingIds.add(id);
      } else {
        matchingIds.delete(id);
      }
    }
    renderScripts();
  });

  tabUrl = await getActiveTabUrl();
  // Retry only if a storage event overtook the initial snapshot.
  for (;;) {
    const version = revision;
    const [enabled, index] = await Promise.all([getExtensionEnabled(), listScriptIndex()]);
    const records = tabUrl === null ? [] : await getScripts(index.map((item) => item.id));
    if (version !== revision) {
      continue;
    }
    elements.globalToggle.checked = enabled;
    scriptIndex = index;
    for (const record of records) {
      if (record !== null && tabUrl !== null && scriptMatchesUrl(record.meta, tabUrl)) {
        matchingIds.add(record.id);
      }
    }
    ready = true;
    break;
  }
  elements.globalToggle.disabled = false;
  renderScripts();
};

const handleGlobalToggle = async (): Promise<void> => {
  const enabled = elements.globalToggle.checked;
  elements.globalToggle.disabled = true;
  try {
    await withScriptMutation(async () => {
      await setExtensionEnabled(enabled);
      const error = await reconcileRegistrations();
      if (error !== null) {
        throw new Error(error.message);
      }
    });
  } catch (error) {
    elements.globalToggle.checked = await getExtensionEnabled();
    renderScripts();
    throw error;
  } finally {
    elements.globalToggle.disabled = false;
    renderScripts();
  }
};

const renderScripts = (): void => {
  const visibleIds = new Set<ScriptId>();
  let position = 0;
  for (const item of scriptIndex) {
    if (!matchingIds.has(item.id)) {
      continue;
    }
    visibleIds.add(item.id);
    let row = rows.get(item.id);
    if (row === undefined) {
      row = createScriptRow(item.id);
      rows.set(item.id, row);
    }
    if (row.name.textContent !== item.name) {
      row.name.textContent = item.name;
      row.edit.title = `edit ${item.name}`;
      row.toggle.setAttribute("aria-label", `enable ${item.name}`);
    }
    if (!row.pending) {
      row.toggle.checked = item.status === "enabled";
    }
    row.toggle.disabled = row.pending || !elements.globalToggle.checked;
    const current = elements.scripts.children[position] ?? null;
    if (current !== row.element) {
      elements.scripts.insertBefore(row.element, current);
    }
    position += 1;
  }
  for (const [id, row] of rows) {
    if (!visibleIds.has(id)) {
      row.element.remove();
      rows.delete(id);
      matchingIds.delete(id);
    }
  }
};

const createScriptRow = (id: ScriptId): ScriptRow => {
  const element = document.createElement("div");
  element.className = "script-row";
  const name = document.createElement("span");
  const edit = document.createElement("button");
  edit.type = "button";
  edit.textContent = "</>";
  edit.addEventListener("click", () => {
    void runAction(async () => {
      await setPendingOptionsScriptId(id);
      await chrome.runtime.openOptionsPage();
      window.close();
    });
  });

  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  const row = { element, name, edit, toggle, pending: false };
  toggle.addEventListener("change", () => {
    const enabled = toggle.checked;
    row.pending = true;
    toggle.disabled = true;
    void runAction(async () => {
      try {
        await setScriptEnabled(id, enabled);
      } catch (error) {
        toggle.checked = (await getScript(id))?.status === "enabled";
        throw error;
      } finally {
        row.pending = false;
        renderScripts();
      }
    });
  });
  element.append(name, edit, toggle);
  return row;
};

const getActiveTabUrl = async (): Promise<string | null> => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.url ?? null;
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
