import { parseUserScriptMeta, type ParseError } from "../domain/metadata";
import { err, ok, type Result, type UserScriptRecord } from "../domain/types";
import { createScriptId } from "./id";

export const createImportedUserScript = (
  source: string,
  position: number,
): Result<UserScriptRecord, ParseError> => {
  const parsed = parseUserScriptMeta(source);
  if (!parsed.ok) {
    return err(parsed.error);
  }

  return ok({
    id: createScriptId(),
    source,
    meta: parsed.value,
    status: "enabled",
    position,
  });
};
