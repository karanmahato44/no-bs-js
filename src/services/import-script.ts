import { parseUserScriptMeta, type ParseError } from "../domain/metadata";
import { err, ok, type Result, type UserScriptRecord } from "../domain/types";
import { sha256Hex } from "./hash";
import { createScriptId } from "./id";

export const createImportedUserScript = async (
  source: string,
  position: number,
): Promise<Result<UserScriptRecord, ParseError>> => {
  const parsed = parseUserScriptMeta(source);
  if (!parsed.ok) {
    return err(parsed.error);
  }

  const now = Date.now();
  return ok({
    id: createScriptId(),
    sourceHash: await sha256Hex(source),
    source,
    meta: parsed.value,
    status: "enabled",
    position,
    createdAt: now,
    updatedAt: now,
  });
};
