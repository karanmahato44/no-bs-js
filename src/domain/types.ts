export type ScriptId = string & { readonly __brand: "ScriptId" };

export type RunAt = "document_start" | "document_end" | "document_idle";

export type ScriptStatus = "enabled" | "disabled";

export type ParsedUserScriptMeta = {
  name: string;
  matches: readonly string[];
  excludeMatches: readonly string[];
  includeGlobs: readonly string[];
  excludeGlobs: readonly string[];
  runAt: RunAt;
};

export type UserScriptRecord = {
  id: ScriptId;
  source: string;
  meta: ParsedUserScriptMeta;
  status: ScriptStatus;
  position: number;
};

export type ScriptIndexItem = {
  id: ScriptId;
  name: string;
  status: ScriptStatus;
  position: number;
};

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
