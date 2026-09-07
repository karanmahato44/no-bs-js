import type { ScriptId } from "../domain/types";
import { syncScriptRegistration } from "./registration";
import { updateScriptStatus } from "./storage";

// One origin-wide lock covers popup, options tabs, and the service worker.
export const withScriptMutation = <T>(action: () => Promise<T>): Promise<T> =>
  navigator.locks.request("script-mutation", action);

export const setScriptEnabled = (id: ScriptId, enabled: boolean): Promise<void> =>
  withScriptMutation(async () => {
    const record = await updateScriptStatus(id, enabled ? "enabled" : "disabled");
    if (record === null) {
      throw new Error("script not found");
    }
    const error = await syncScriptRegistration(record);
    if (error !== null) {
      throw new Error(error.message);
    }
  });
