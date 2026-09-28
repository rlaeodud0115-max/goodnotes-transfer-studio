export type WireValue = bigint | Uint8Array;

export interface WireField {
  number: number;
  wireType: 0 | 1 | 2 | 5;
  value: WireValue;
}

export interface WireMessage { fields: WireField[] }

export function fields(message: WireMessage, number: number): WireField[] {
  return message.fields.filter((field) => field.number === number);
}

export function first(message: WireMessage | undefined, number: number): WireField | undefined {
  return message?.fields.find((field) => field.number === number);
}

export function setBytes(message: WireMessage, number: number, value: Uint8Array, occurrence = 0): void {
  let seen = 0;
  for (const field of message.fields) {
    if (field.number !== number) continue;
    if (seen++ !== occurrence) continue;
    field.wireType = 2;
    field.value = value;
    return;
  }
  message.fields.push({ number, wireType: 2, value });
}

export function setText(message: WireMessage, number: number, value: string, occurrence = 0): void {
  setBytes(message, number, new TextEncoder().encode(value), occurrence);
}

export function setInteger(message: WireMessage, number: number, value: bigint | number, occurrence = 0): void {
  let seen = 0;
  for (const field of message.fields) {
    if (field.number !== number) continue;
    if (seen++ !== occurrence) continue;
    field.wireType = 0;
    field.value = typeof value === "number" ? BigInt(value) : value;
    return;
  }
  message.fields.push({ number, wireType: 0, value: typeof value === "number" ? BigInt(value) : value });
}

export function setNested(message: WireMessage, number: number, child: WireMessage, occurrence = 0): void {
  setBytes(message, number, encodeMessage(child), occurrence);
}

export function setFloat32(message: WireMessage, number: number, value: number): void {
  const raw = new Uint8Array(4);
  new DataView(raw.buffer).setFloat32(0, value, true);
  const field = first(message, number);
  if (field) { field.wireType = 5; field.value = raw; }
  else message.fields.push({ number, wireType: 5, value: raw });
}

export function decodeVarint(data: Uint8Array, start = 0): [bigint, number] {
  let value = 0n;
  let shift = 0n;
  let offset = start;
  while (offset < data.length) {
    const byte = data[offset++];
    if (byte == null) break;
    value |= BigInt(byte & 0x7f) << shift;
    if (byte < 0x80) return [value, offset];
    shift += 7n;
    if (shift > 70n) throw new Error("GoodNotes 인덱스의 숫자 필드가 너무 깁니다.");
  }
  throw new Error("GoodNotes 인덱스의 숫자 필드가 잘려 있습니다.");
}

export function encodeVarint(input: bigint | number): Uint8Array {
  let value = typeof input === "number" ? BigInt(input) : input;
  if (value < 0n) value &= (1n << 64n) - 1n;
  const output: number[] = [];
  do {
    let byte = Number(value & 0x7fn);
    value >>= 7n;
    if (value) byte |= 0x80;
    output.push(byte);
  } while (value);
  return Uint8Array.from(output);
}

export function decodeMessage(data: Uint8Array): WireMessage {
  const output: WireField[] = [];
  let offset = 0;
  while (offset < data.length) {
    let tag: bigint;
    [tag, offset] = decodeVarint(data, offset);
    const number = Number(tag >> 3n);
    const wireType = Number(tag & 7n) as WireField["wireType"];
    if (number <= 0) throw new Error("GoodNotes 인덱스의 필드 번호가 올바르지 않습니다.");
    let value: WireValue;
    if (wireType === 0) {
      [value, offset] = decodeVarint(data, offset);
    } else if (wireType === 1 || wireType === 5) {
      const length = wireType === 1 ? 8 : 4;
      if (offset + length > data.length) throw new Error("GoodNotes 인덱스의 고정 필드가 잘려 있습니다.");
      value = data.slice(offset, offset + length);
      offset += length;
    } else if (wireType === 2) {
      let length: bigint;
      [length, offset] = decodeVarint(data, offset);
      const end = offset + Number(length);
      if (end > data.length) throw new Error("GoodNotes 인덱스의 데이터 필드가 잘려 있습니다.");
      value = data.slice(offset, end);
      offset = end;
    } else {
      throw new Error(`지원하지 않는 GoodNotes 필드 형식입니다. (${wireType})`);
    }
    output.push({ number, wireType, value });
  }
  return { fields: output };
}

export function decodeDelimited(data: Uint8Array): WireMessage[] {
  const output: WireMessage[] = [];
  let offset = 0;
  while (offset < data.length) {
    let length: bigint;
    [length, offset] = decodeVarint(data, offset);
    const end = offset + Number(length);
    if (end > data.length) throw new Error("GoodNotes 인덱스 레코드가 잘려 있습니다.");
    output.push(decodeMessage(data.slice(offset, end)));
    offset = end;
  }
  return output;
}

export function encodeMessage(message: WireMessage): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const field of message.fields) {
    chunks.push(encodeVarint((BigInt(field.number) << 3n) | BigInt(field.wireType)));
    if (field.wireType === 0) {
      if (typeof field.value !== "bigint") throw new Error("숫자 필드 값이 올바르지 않습니다.");
      chunks.push(encodeVarint(field.value));
    } else if (field.wireType === 1 || field.wireType === 5) {
      if (!(field.value instanceof Uint8Array) || field.value.length !== (field.wireType === 1 ? 8 : 4)) {
        throw new Error("고정 필드 길이가 올바르지 않습니다.");
      }
      chunks.push(field.value);
    } else {
      if (!(field.value instanceof Uint8Array)) throw new Error("데이터 필드 값이 올바르지 않습니다.");
      chunks.push(encodeVarint(field.value.length), field.value);
    }
  }
  return concatenate(chunks);
}

export function encodeDelimited(messages: WireMessage[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const message of messages) {
    const encoded = encodeMessage(message);
    chunks.push(encodeVarint(encoded.length), encoded);
  }
  return concatenate(chunks);
}

function concatenate(chunks: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}

export function nested(field: WireField | undefined): WireMessage | undefined {
  if (!field || field.wireType !== 2 || !(field.value instanceof Uint8Array)) return undefined;
  try { return decodeMessage(field.value); } catch { return undefined; }
}

export function text(field: WireField | undefined): string | undefined {
  if (!field || field.wireType !== 2 || !(field.value instanceof Uint8Array)) return undefined;
  try { return new TextDecoder("utf-8", { fatal: true }).decode(field.value); } catch { return undefined; }
}

export function integer(field: WireField | undefined): number | undefined {
  return field?.wireType === 0 && typeof field.value === "bigint" ? Number(field.value) : undefined;
}
