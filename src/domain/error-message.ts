export const describeError = (error: unknown): string => {
  if (typeof error === "string") {
    return nonEmpty(error);
  }

  if (error instanceof Error) {
    return nonEmpty(error.message);
  }

  if (hasMessage(error)) {
    return nonEmpty(error.message);
  }

  return "unknown error";
};

const hasMessage = (value: unknown): value is { message: string } =>
  typeof value === "object" &&
  value !== null &&
  "message" in value &&
  typeof value.message === "string";

const nonEmpty = (message: string): string => {
  const trimmed = message.trim();
  return trimmed.length === 0 ? "unknown error" : trimmed;
};
