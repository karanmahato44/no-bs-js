import { describe, expect, it } from "vitest";

import { createZipBlob } from "./export-zip";

const decoder = new TextDecoder();

describe("createZipBlob", () => {
  it("creates an uncompressed zip with utf-8 file names", async () => {
    const blob = createZipBlob([
      { path: "alpha.user.js", content: "abc" },
      { path: "beta-✓.user.js", content: "console.log(1);" },
    ]);

    expect(blob.type).toBe("application/zip");

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const first = readLocalEntry(bytes, 0);
    const second = readLocalEntry(bytes, first.nextOffset);
    const endOffset = bytes.byteLength - 22;

    expect(first.path).toBe("alpha.user.js");
    expect(first.content).toBe("abc");
    expect(first.crc).toBe(0x352441c2);
    expect(second.path).toBe("beta-✓.user.js");
    expect(second.content).toBe("console.log(1);");
    expect(readUint32(bytes, second.nextOffset)).toBe(0x02014b50);
    expect(readUint32(bytes, endOffset)).toBe(0x06054b50);
    expect(readUint16(bytes, endOffset + 8)).toBe(2);
    expect(readUint16(bytes, endOffset + 10)).toBe(2);
    expect(readUint32(bytes, endOffset + 16)).toBe(second.nextOffset);
  });
});

const readLocalEntry = (
  bytes: Uint8Array,
  offset: number,
): { path: string; content: string; crc: number; nextOffset: number } => {
  expect(readUint32(bytes, offset)).toBe(0x04034b50);
  const crc = readUint32(bytes, offset + 14);
  const size = readUint32(bytes, offset + 18);
  const nameLength = readUint16(bytes, offset + 26);
  const dataOffset = offset + 30 + nameLength;
  const dataEnd = dataOffset + size;

  return {
    path: decoder.decode(bytes.subarray(offset + 30, dataOffset)),
    content: decoder.decode(bytes.subarray(dataOffset, dataEnd)),
    crc,
    nextOffset: dataEnd,
  };
};

const readUint16 = (bytes: Uint8Array, offset: number): number =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);

const readUint32 = (bytes: Uint8Array, offset: number): number =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
