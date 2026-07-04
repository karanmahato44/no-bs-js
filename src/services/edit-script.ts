import { parseUserScriptMeta, type ParseError } from "../domain/metadata";
import { err, ok, type Result, type UserScriptRecord } from "../domain/types";
import { sha256Hex } from "./hash";

export const updateScriptSource = async (
  record: UserScriptRecord,
  source: string,
  now = Date.now(),
): Promise<Result<UserScriptRecord, ParseError>> => {
  const parsed = parseUserScriptMeta(source);
  if (!parsed.ok) {
    return err(parsed.error);
  }

  return ok({
    ...record,
    source,
    sourceHash: await sha256Hex(source),
    meta: parsed.value,
    updatedAt: now,
  });
};
