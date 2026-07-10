import { parseUserScriptMeta, type ParseError } from "../domain/metadata";
import { err, ok, type Result, type UserScriptRecord } from "../domain/types";

export const updateScriptSource = (
  record: UserScriptRecord,
  source: string,
): Result<UserScriptRecord, ParseError> => {
  const parsed = parseUserScriptMeta(source);
  if (!parsed.ok) {
    return err(parsed.error);
  }

  return ok({
    ...record,
    source,
    meta: parsed.value,
  });
};
