export type ZipTextEntry = {
  path: string;
  content: string;
};

type PreparedEntry = {
  name: Uint8Array;
  data: Uint8Array;
  crc: number;
  offset: number;
};

const encoder = new TextEncoder();
let crcTable: Uint32Array | null = null;
const localHeaderSize = 30;
const centralHeaderSize = 46;
const endRecordSize = 22;
const localHeaderSignature = 0x04034b50;
const centralHeaderSignature = 0x02014b50;
const endRecordSignature = 0x06054b50;
const utf8Flag = 0x0800;
const dosDate1980 = 33;
const maxUint16 = 0xffff;
const maxUint32 = 0xffffffff;

export const createZipBlob = (entries: readonly ZipTextEntry[]): Blob => {
  if (entries.length > maxUint16) {
    throw new Error("too many files for zip");
  }

  const prepared: PreparedEntry[] = [];
  prepared.length = entries.length;
  let entryIndex = 0;
  let localSize = 0;
  let centralSize = 0;

  for (const input of entries) {
    const entry = prepareEntry(input, localSize);
    assertZipNameLength(entry.name.byteLength);
    assertZipSize(entry.data.byteLength, "file too large");
    prepared[entryIndex] = entry;
    entryIndex += 1;

    localSize += localHeaderSize + entry.name.byteLength + entry.data.byteLength;
    centralSize += centralHeaderSize + entry.name.byteLength;
    assertZipSize(localSize, "zip too large");
    assertZipSize(centralSize, "zip too large");
  }

  const totalSize = localSize + centralSize + endRecordSize;
  assertZipSize(totalSize, "zip too large");

  const output: Uint8Array<ArrayBuffer> = new Uint8Array(totalSize);
  const view = new DataView(output.buffer);
  let offset = 0;

  for (const entry of prepared) {
    writeLocalHeader(view, offset, entry);
    offset += localHeaderSize;
    output.set(entry.name, offset);
    offset += entry.name.byteLength;
    output.set(entry.data, offset);
    offset += entry.data.byteLength;
  }

  const centralOffset = offset;
  for (const entry of prepared) {
    writeCentralHeader(view, offset, entry);
    offset += centralHeaderSize;
    output.set(entry.name, offset);
    offset += entry.name.byteLength;
  }

  writeEndRecord(view, offset, entries.length, centralSize, centralOffset);
  return new Blob([output.buffer], { type: "application/zip" });
};

const prepareEntry = (entry: ZipTextEntry, offset: number): PreparedEntry => {
  const name = encoder.encode(entry.path);
  if (name.byteLength === 0) {
    throw new Error("zip filename empty");
  }

  const data = encoder.encode(entry.content);
  return { name, data, crc: crc32(data), offset };
};

const writeLocalHeader = (view: DataView, offset: number, entry: PreparedEntry): void => {
  view.setUint32(offset, localHeaderSignature, true);
  view.setUint16(offset + 4, 20, true);
  view.setUint16(offset + 6, utf8Flag, true);
  view.setUint16(offset + 8, 0, true);
  view.setUint16(offset + 10, 0, true);
  view.setUint16(offset + 12, dosDate1980, true);
  view.setUint32(offset + 14, entry.crc, true);
  view.setUint32(offset + 18, entry.data.byteLength, true);
  view.setUint32(offset + 22, entry.data.byteLength, true);
  view.setUint16(offset + 26, entry.name.byteLength, true);
};

const writeCentralHeader = (view: DataView, offset: number, entry: PreparedEntry): void => {
  view.setUint32(offset, centralHeaderSignature, true);
  view.setUint16(offset + 4, 20, true);
  view.setUint16(offset + 6, 20, true);
  view.setUint16(offset + 8, utf8Flag, true);
  view.setUint16(offset + 10, 0, true);
  view.setUint16(offset + 12, 0, true);
  view.setUint16(offset + 14, dosDate1980, true);
  view.setUint32(offset + 16, entry.crc, true);
  view.setUint32(offset + 20, entry.data.byteLength, true);
  view.setUint32(offset + 24, entry.data.byteLength, true);
  view.setUint16(offset + 28, entry.name.byteLength, true);
  view.setUint32(offset + 42, entry.offset, true);
};

const writeEndRecord = (
  view: DataView,
  offset: number,
  entries: number,
  centralSize: number,
  centralOffset: number,
): void => {
  view.setUint32(offset, endRecordSignature, true);
  view.setUint16(offset + 8, entries, true);
  view.setUint16(offset + 10, entries, true);
  view.setUint32(offset + 12, centralSize, true);
  view.setUint32(offset + 16, centralOffset, true);
};

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < table.length; i += 1) {
    let crc = i;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 0 ? crc >>> 1 : 0xedb88320 ^ (crc >>> 1);
    }
    table[i] = crc >>> 0;
  }
  return table;
}

const getCrcTable = (): Uint32Array => {
  crcTable ??= buildCrcTable();
  return crcTable;
};

const crc32 = (data: Uint8Array): number => {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let index = 0; index < data.byteLength; index += 1) {
    const byte = data[index] as number;
    crc = (table[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const assertZipSize = (value: number, message: string): void => {
  if (value > maxUint32) {
    throw new Error(message);
  }
};

const assertZipNameLength = (value: number): void => {
  if (value > maxUint16) {
    throw new Error("filename too long");
  }
};
