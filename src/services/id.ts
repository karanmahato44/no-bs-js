import type { ScriptId } from "../domain/types";

export const createScriptId = (): ScriptId => crypto.randomUUID() as ScriptId;
