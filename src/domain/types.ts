export type ScriptId = string & { readonly __brand: "ScriptId" };

export type RunAt = "document_start" | "document_end" | "document_idle";

export type ScriptStatus = "enabled" | "disabled";

export type ParsedUserScriptMeta = {
  name: string;
  namespace: string | null;
  version: string | null;
  description: string | null;
  matches: readonly string[];
  excludeMatches: readonly string[];
  includeGlobs: readonly string[];
  excludeGlobs: readonly string[];
  grants: readonly string[];
  runAt: RunAt;
};

export type UserScriptRecord = {
  id: ScriptId;
  sourceHash: string;
  source: string;
  meta: ParsedUserScriptMeta;
  status: ScriptStatus;
  position: number;
  createdAt: number;
  updatedAt: number;
};

export type ScriptIndexItem = {
  id: ScriptId;
  name: string;
  namespace: string | null;
  status: ScriptStatus;
  position: number;
  updatedAt: number;
};

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
