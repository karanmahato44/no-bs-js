import "./style.css";

import { describeError } from "../domain/error-message";
import type { ScriptId, ScriptIndexItem, UserScriptRecord } from "../domain/types";
import { updateScriptSource } from "../services/edit-script";
import { createImportedUserScript } from "../services/import-script";
import {
  syncScriptRegistration,
  unregisterScript,
  userScriptsAvailable,
} from "../services/registration";
import {
  deleteScript,
  getExtensionEnabled,
  getScript,
  getScripts,
  listScriptIndex,
  onPendingOptionsScriptId,
  saveScript,
  saveScripts,
  takePendingOptionsScriptId,
  updateScriptStatus,
} from "../services/storage";
import type { ZipTextEntry } from "../services/export-zip";

const elements = {
  fileInput: byId<HTMLInputElement>("fileInput"),
  pasteButton: byId<HTMLButtonElement>("pasteButton"),
  exportAllButton: byId<HTMLButtonElement>("exportAllButton"),
  pastePanel: byId<HTMLElement>("pastePanel"),
  pasteSource: byId<HTMLTextAreaElement>("pasteSource"),
  pasteImportButton: byId<HTMLButtonElement>("pasteImportButton"),
  pasteCancelButton: byId<HTMLButtonElement>("pasteCancelButton"),
  errorPanel: byId<HTMLElement>("errorPanel"),
  scripts: byId<HTMLElement>("scripts"),
  detailEmpty: byId<HTMLElement>("detailEmpty"),
  detailPanel: byId<HTMLElement>("detailPanel"),
  copyButton: byId<HTMLButtonElement>("copyButton"),
  editButton: byId<HTMLButtonElement>("editButton"),
  saveButton: byId<HTMLButtonElement>("saveButton"),
  cancelEditButton: byId<HTMLButtonElement>("cancelEditButton"),
  exportButton: byId<HTMLButtonElement>("exportButton"),
  deleteButton: byId<HTMLButtonElement>("deleteButton"),
  scriptSource: byId<HTMLElement>("scriptSource"),
  scriptEditor: byId<HTMLTextAreaElement>("scriptEditor"),
};

let selectedId: ScriptId | null = null;
let selectedRecord: UserScriptRecord | null = null;
let copyResetTimer: number | null = null;
const scriptSearchParam = "script";

type ImportInput = {
  label: string;
  source: string;
};

type ImportReadResult = { input: ImportInput; error: null } | { input: null; error: string };

type ImportCreateResult = {
  input: ImportInput;
  record: UserScriptRecord | null;
  error: string | null;
};

const boot = async (): Promise<void> => {
  if (!userScriptsAvailable()) {
    showError("chrome.userScripts unavailable. enable user scripts/developer mode.");
  }

  elements.fileInput.addEventListener("change", () => {
    void runAction(handleFileImport);
  });
  elements.pasteButton.addEventListener("click", () => {
    void runAction(handlePasteImport);
  });
  elements.exportAllButton.addEventListener("click", () => {
    void runAction(handleExportAll);
  });
  elements.pasteImportButton.addEventListener("click", () => {
    void runAction(handlePasteSubmit);
  });
  elements.pasteCancelButton.addEventListener("click", () => {
    clearError();
    hidePastePanel();
  });
  elements.copyButton.addEventListener("click", () => {
    void runAction(handleCopy);
  });
  elements.editButton.addEventListener("click", () => {
    void runAction(startEdit);
  });
  elements.saveButton.addEventListener("click", () => {
    void runAction(handleSaveEdit);
  });
  elements.cancelEditButton.addEventListener("click", () => {
    void runAction(cancelEdit);
  });
  elements.scriptEditor.addEventListener("keydown", handleEditorKeydown);
  elements.exportButton.addEventListener("click", () => {
    void runAction(handleExport);
  });
  elements.deleteButton.addEventListener("click", () => {
    void runAction(handleDelete);
  });
  window.addEventListener("popstate", () => {
    void runAction(restoreSelectedScriptFromUrl);
  });
  onPendingOptionsScriptId(() => {
    void runAction(async () => {
      await restorePendingSelectedScript();
    });
  });

  if (!(await restorePendingSelectedScript())) {
    await restoreSelectedScriptFromUrl();
  }
};

const handleFileImport = async (): Promise<void> => {
  const files = Array.from(elements.fileInput.files ?? []);
  if (files.length === 0) {
    return;
  }

  try {
    const reads = await Promise.all(files.map(readImportFile));
    const inputs: ImportInput[] = [];
    const errors: string[] = [];
    for (const result of reads) {
      if (result.input === null) {
        errors.push(result.error);
      } else {
        inputs.push(result.input);
      }
    }
    await importSources(inputs, { clearPaste: false, initialErrors: errors });
  } finally {
    elements.fileInput.value = "";
  }
};

const handlePasteImport = (): void => {
  clearError();
  elements.detailEmpty.hidden = true;
  elements.detailPanel.hidden = true;
  elements.pastePanel.hidden = false;
  elements.pasteSource.focus();
};

const handlePasteSubmit = async (): Promise<void> => {
  const source = elements.pasteSource.value;
  if (source.trim().length === 0) {
    showError("source empty");
    return;
  }

  await importSources([{ label: "paste", source }], { clearPaste: true });
};

const hidePastePanel = (): void => {
  elements.pastePanel.hidden = true;
  elements.pasteSource.value = "";
  if (selectedRecord === null) {
    renderEmpty();
  } else {
    renderDetail(selectedRecord);
  }
};

const readImportFile = async (file: File): Promise<ImportReadResult> => {
  try {
    return { input: { label: file.name, source: await file.text() }, error: null };
  } catch (error) {
    return { input: null, error: `${file.name}: ${describeError(error)}` };
  }
};

const importSources = async (
  inputs: readonly ImportInput[],
  options: { clearPaste: boolean; initialErrors?: readonly string[] },
): Promise<void> => {
  const errors = [...(options.initialErrors ?? [])];
  const prefixErrors = inputs.length > 1 || errors.length > 0;
  const basePosition = inputs.length === 0 ? 0 : (await listScriptIndex()).length;
  const created = inputs.map((input, offset) =>
    createImportRecord(input, basePosition + offset, prefixErrors),
  );
  const imports: Array<{ input: ImportInput; record: UserScriptRecord }> = [];

  for (const item of created) {
    if (item.error !== null) {
      errors.push(item.error);
    }
    if (item.record !== null) {
      imports.push({ input: item.input, record: item.record });
    }
  }

  const records = imports.map((item) => item.record);
  await saveScripts(records);
  const extensionEnabled = records.length === 0 ? true : await getExtensionEnabled();
  const registrationErrors = await Promise.all(
    records.map((record) => syncScriptRegistration(record, { extensionEnabled })),
  );
  for (const [index, error] of registrationErrors.entries()) {
    const item = imports[index];
    if (error !== null && item !== undefined) {
      errors.push(formatImportError(item.input.label, error.message, true));
    }
  }

  const lastRecord = records.at(-1) ?? null;
  if (lastRecord !== null) {
    selectedId = lastRecord.id;
    selectedRecord = lastRecord;
    syncSelectedScriptUrl(lastRecord.id);
    if (options.clearPaste) {
      elements.pasteSource.value = "";
    }
    await renderList();
    renderDetail(lastRecord);
  }

  if (errors.length > 0) {
    showError(errors.join("\n"));
  }
};

const createImportRecord = (
  input: ImportInput,
  position: number,
  prefixErrors: boolean,
): ImportCreateResult => {
  const result = createImportedUserScript(input.source, position);
  if (!result.ok) {
    return {
      input,
      record: null,
      error: formatImportError(input.label, result.error.message, prefixErrors),
    };
  }

  return { input, record: result.value, error: null };
};

const formatImportError = (label: string, message: string, prefix: boolean): string => {
  if (!prefix && label === "paste") {
    return message;
  }

  return `${label}: ${message}`;
};

const toggleScript = async (id: ScriptId, enabled: boolean): Promise<void> => {
  const status = enabled ? "enabled" : "disabled";
  const record = await updateScriptStatus(id, status);
  if (record === null) {
    showError("script not found");
    return;
  }

  const error = await syncScriptRegistration(record);
  selectedRecord = record;
  if (error !== null) {
    showError(error.message);
  }
  await renderList();
  if (selectedId === id) {
    renderDetail(record);
  }
};

const handleCopy = async (): Promise<void> => {
  const source = getVisibleSource();
  if (source === null) {
    return;
  }

  await navigator.clipboard.writeText(source);
  flashButton(elements.copyButton, "copied");
};

const handleExport = (): void => {
  if (selectedRecord === null) {
    return;
  }

  const source = getVisibleSource() ?? selectedRecord.source;
  downloadBlob(new Blob([source], { type: "text/javascript" }), userScriptFileName(selectedRecord));
};

const handleExportAll = async (): Promise<void> => {
  const scriptIndex = await listScriptIndex();
  if (scriptIndex.length === 0) {
    showError("no scripts");
    return;
  }

  const [records, { createZipBlob }] = await Promise.all([
    getScripts(scriptIndex.map((item) => item.id)),
    import("../services/export-zip"),
  ]);
  const missing: string[] = [];
  const usedNames = new Set<string>();
  const entries: ZipTextEntry[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record == null) {
      const item = scriptIndex[index];
      missing.push(item?.name ?? `script ${index + 1}`);
    } else {
      entries.push({ path: userScriptFileName(record, usedNames), content: record.source });
    }
  }

  if (entries.length === 0) {
    showError("no scripts");
    return;
  }

  downloadBlob(createZipBlob(entries), "no-bs-js-userscripts.zip");
  if (missing.length > 0) {
    showError(`missing scripts: ${missing.join(", ")}`);
  }
};

const startEdit = (): void => {
  clearError();
  if (selectedRecord === null) {
    return;
  }

  elements.scriptEditor.value = selectedRecord.source;
  elements.scriptSource.textContent = "";
  setEditMode(true);
  elements.scriptEditor.focus();
};

const cancelEdit = (): void => {
  clearError();
  setEditMode(false);
  if (selectedRecord !== null) {
    renderDetail(selectedRecord);
  }
};

const handleSaveEdit = async (): Promise<void> => {
  if (selectedRecord === null) {
    return;
  }

  const source = elements.scriptEditor.value;
  const updated = updateScriptSource(selectedRecord, source);
  if (!updated.ok) {
    showError(updated.error.message);
    return;
  }

  await saveScript(updated.value);
  const error = await syncScriptRegistration(updated.value);
  if (error !== null) {
    showError(error.message);
  }

  selectedRecord = updated.value;
  selectedId = updated.value.id;
  syncSelectedScriptUrl(updated.value.id);
  await renderList();
  renderDetail(updated.value);
};

const handleEditorKeydown = (event: KeyboardEvent): void => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    void runAction(handleSaveEdit);
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    void runAction(cancelEdit);
  }
};

const getVisibleSource = (): string | null => {
  if (selectedRecord === null) {
    return null;
  }

  return elements.scriptEditor.hidden ? selectedRecord.source : elements.scriptEditor.value;
};

const handleDelete = async (): Promise<void> => {
  if (selectedRecord === null) {
    return;
  }

  if (!window.confirm(`delete ${selectedRecord.meta.name}?`)) {
    return;
  }

  const id = selectedRecord.id;
  const error = await unregisterScript(id);
  if (error !== null) {
    showError(error.message);
    return;
  }

  await deleteScript(id);
  selectedId = null;
  selectedRecord = null;
  syncSelectedScriptUrl(null);
  await renderList();
  renderEmpty();
};

const renderList = async (): Promise<void> => {
  const index = await listScriptIndex();
  elements.scripts.replaceChildren(...index.map(renderScriptButton));
};

const renderScriptButton = (item: ScriptIndexItem): HTMLElement => {
  const row = document.createElement("div");
  row.className = "script-row";
  row.dataset["selected"] = item.id === selectedId ? "true" : "false";

  const title = document.createElement("button");
  title.className = "script-select";
  title.type = "button";
  title.textContent = item.name;
  title.addEventListener("click", () => {
    void runAction(() => selectScript(item.id));
  });

  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.checked = item.status === "enabled";
  toggle.addEventListener("change", () => {
    void runAction(() => toggleScript(item.id, toggle.checked));
  });

  row.append(title, toggle);
  return row;
};

const selectScript = async (id: ScriptId): Promise<void> => {
  await loadScriptSelection(id, true);
};

const restoreSelectedScriptFromUrl = async (): Promise<void> => {
  const id = selectedScriptIdFromUrl();
  if (id === null) {
    selectedId = null;
    selectedRecord = null;
    await renderList();
    renderEmpty();
    return;
  }

  await loadScriptSelection(id, false);
};

const restorePendingSelectedScript = async (): Promise<boolean> => {
  const id = await takePendingOptionsScriptId();
  if (id === null) {
    return false;
  }

  await loadScriptSelection(id, true);
  return true;
};

const loadScriptSelection = async (id: ScriptId, syncUrl: boolean): Promise<void> => {
  const record = await getScript(id);
  if (record === null) {
    selectedId = null;
    selectedRecord = null;
    syncSelectedScriptUrl(null);
    await renderList();
    renderEmpty();
    showError("script not found");
    return;
  }

  selectedId = id;
  selectedRecord = record;
  if (syncUrl) {
    syncSelectedScriptUrl(id);
  }
  await renderList();
  renderDetail(record);
};

const selectedScriptIdFromUrl = (): ScriptId | null => {
  const value = new URL(window.location.href).searchParams.get(scriptSearchParam);
  return value === null || value.length === 0 ? null : (value as ScriptId);
};

const syncSelectedScriptUrl = (id: ScriptId | null): void => {
  const url = new URL(window.location.href);
  if (id === null) {
    url.searchParams.delete(scriptSearchParam);
  } else {
    url.searchParams.set(scriptSearchParam, id);
  }
  window.history.replaceState(null, "", url);
};

const renderDetail = (record: UserScriptRecord): void => {
  elements.detailEmpty.hidden = true;
  elements.pastePanel.hidden = true;
  elements.detailPanel.hidden = false;
  elements.scriptSource.textContent = record.source;
  setEditMode(false);
};

const renderEmpty = (): void => {
  elements.pastePanel.hidden = true;
  elements.detailEmpty.hidden = false;
  elements.detailPanel.hidden = true;
  elements.scriptSource.textContent = "";
  setEditMode(false);
};

const setEditMode = (editing: boolean): void => {
  elements.scriptSource.hidden = editing;
  elements.scriptEditor.hidden = !editing;
  elements.editButton.hidden = editing;
  elements.saveButton.hidden = !editing;
  elements.cancelEditButton.hidden = !editing;
  if (!editing) {
    elements.scriptEditor.value = "";
  }
};

const runAction = async (action: () => void | Promise<void>): Promise<void> => {
  clearError();
  try {
    await action();
  } catch (error) {
    showError(describeError(error));
  }
};

const showError = (message: string): void => {
  elements.errorPanel.textContent = message;
  elements.errorPanel.hidden = false;
};

const clearError = (): void => {
  elements.errorPanel.textContent = "";
  elements.errorPanel.hidden = true;
};

const flashButton = (button: HTMLButtonElement, label: string): void => {
  const original = button.textContent ?? "";
  button.textContent = label;

  if (copyResetTimer !== null) {
    window.clearTimeout(copyResetTimer);
  }

  copyResetTimer = window.setTimeout(() => {
    button.textContent = original;
    copyResetTimer = null;
  }, 900);
};

const downloadBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
};

const userScriptFileName = (record: UserScriptRecord, usedNames?: Set<string>): string => {
  const base = fileSafeName(record.meta.name);
  let name = `${base}.user.js`;
  if (usedNames === undefined) {
    return name;
  }

  for (let suffix = 2; usedNames.has(name); suffix += 1) {
    name = `${base}-${suffix}.user.js`;
  }

  usedNames.add(name);
  return name;
};

const fileSafeName = (name: string): string => {
  const safe = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return safe.length === 0 ? "script" : safe;
};

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`missing element #${id}`);
  }
  return element as T;
}

void boot().catch((error: unknown) => {
  showError(describeError(error));
});
