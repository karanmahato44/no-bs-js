import { describe, expect, it } from "vitest";

import { describeError } from "./error-message";

describe("describeError", () => {
  it("uses string messages", () => {
    expect(describeError("bad source")).toBe("bad source");
  });

  it("uses Error messages", () => {
    expect(describeError(new Error("storage failed"))).toBe("storage failed");
  });

  it("uses message-shaped objects", () => {
    expect(describeError({ message: "runtime failed" })).toBe("runtime failed");
  });

  it("falls back for empty or unknown errors", () => {
    expect(describeError(" ")).toBe("unknown error");
    expect(describeError(null)).toBe("unknown error");
  });
});
