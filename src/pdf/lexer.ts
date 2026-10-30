import { PDFName, PDFObject, PDFRef } from './types';

export enum TokenType {
  Number,
  String,
  Name,
  Keyword,
  DictOpen,
  DictClose,
  ArrayOpen,
  ArrayClose,
  Ref,
  EOF,
}

export interface Token {
  type: TokenType;
  value: any;
  pos: number;
}

export class PDFLexer {
  public buffer: Uint8Array;
  public pos: number;
  public length: number;

  constructor(buffer: Uint8Array, startPos = 0) {
    this.buffer = buffer;
    this.pos = startPos;
    this.length = buffer.length;
  }

  seek(pos: number) {
    this.pos = Math.max(0, Math.min(pos, this.length));
  }

  tell(): number {
    return this.pos;
  }

  isWhitespace(b: number): boolean {
    return b === 0x00 || b === 0x09 || b === 0x0a || b === 0x0c || b === 0x0d || b === 0x20;
  }

  isDelimiter(b: number): boolean {
    return (
      this.isWhitespace(b) ||
      b === 0x28 || // (
      b === 0x29 || // )
      b === 0x3c || // <
      b === 0x3e || // >
      b === 0x5b || // [
      b === 0x5d || // ]
      b === 0x7b || // {
      b === 0x7d || // }
      b === 0x2f || // /
      b === 0x25    // %
    );
  }

  skipWhitespaceAndComments(): void {
    while (this.pos < this.length) {
      const b = this.buffer[this.pos];
      if (this.isWhitespace(b)) {
        this.pos++;
      } else if (b === 0x25) { // %
        while (this.pos < this.length && this.buffer[this.pos] !== 0x0a && this.buffer[this.pos] !== 0x0d) {
          this.pos++;
        }
      } else {
        break;
      }
    }
  }

  peekByte(): number {
    return this.pos < this.length ? this.buffer[this.pos] : -1;
  }

  readByte(): number {
    return this.pos < this.length ? this.buffer[this.pos++] : -1;
  }

  nextToken(): Token {
    this.skipWhitespaceAndComments();
    if (this.pos >= this.length) {
      return { type: TokenType.EOF, value: null, pos: this.pos };
    }

    const startPos = this.pos;
    const b = this.buffer[this.pos];

    if (b === 0x3c) { // <
      if (this.pos + 1 < this.length && this.buffer[this.pos + 1] === 0x3c) {
        this.pos += 2;
        return { type: TokenType.DictOpen, value: '<<', pos: startPos };
      }
      return { type: TokenType.String, value: this.readHexString(), pos: startPos };
    }

    if (b === 0x3e) { // >
      if (this.pos + 1 < this.length && this.buffer[this.pos + 1] === 0x3e) {
        this.pos += 2;
        return { type: TokenType.DictClose, value: '>>', pos: startPos };
      }
      this.pos++;
      return { type: TokenType.Keyword, value: '>', pos: startPos };
    }

    if (b === 0x28) { // (
      return { type: TokenType.String, value: this.readLiteralString(), pos: startPos };
    }

    if (b === 0x2f) { // /
      return { type: TokenType.Name, value: this.readName(), pos: startPos };
    }

    if (b === 0x5b) { // [
      this.pos++;
      return { type: TokenType.ArrayOpen, value: '[', pos: startPos };
    }

    if (b === 0x5d) { // ]
      this.pos++;
      return { type: TokenType.ArrayClose, value: ']', pos: startPos };
    }

    return this.readWordOrNumber(startPos);
  }

  private readLiteralString(): string {
    this.pos++; // skip '('
    let depth = 1;
    const chars: number[] = [];

    while (this.pos < this.length && depth > 0) {
      const b = this.buffer[this.pos++];
      if (b === 0x5c) { // \
        if (this.pos >= this.length) break;
        const esc = this.buffer[this.pos++];
        switch (esc) {
          case 0x6e: chars.push(0x0a); break; // \n
          case 0x72: chars.push(0x0d); break; // \r
          case 0x74: chars.push(0x09); break; // \t
          case 0x62: chars.push(0x08); break; // \b
          case 0x66: chars.push(0x0c); break; // \f
          case 0x5c: chars.push(0x5c); break; // \\
          case 0x28: chars.push(0x28); break; // \(
          case 0x29: chars.push(0x29); break; // \)
          case 0x0d:
            if (this.pos < this.length && this.buffer[this.pos] === 0x0a) this.pos++;
            break;
          case 0x0a:
            break;
          default:
            if (esc >= 0x30 && esc <= 0x37) { // octal
              let oct = esc - 0x30;
              for (let i = 0; i < 2; i++) {
                if (this.pos < this.length && this.buffer[this.pos] >= 0x30 && this.buffer[this.pos] <= 0x37) {
                  oct = (oct << 3) + (this.buffer[this.pos++] - 0x30);
                } else {
                  break;
                }
              }
              chars.push(oct & 0xff);
            } else {
              chars.push(esc);
            }
            break;
        }
      } else if (b === 0x28) {
        depth++;
        chars.push(b);
      } else if (b === 0x29) {
        depth--;
        if (depth > 0) chars.push(b);
      } else {
        chars.push(b);
      }
    }

    return this.decodeStringBytes(new Uint8Array(chars));
  }

  private readHexString(): string {
    this.pos++; // skip '<'
    const hex: number[] = [];
    while (this.pos < this.length) {
      const b = this.buffer[this.pos++];
      if (b === 0x3e) break; // >
      if (!this.isWhitespace(b)) {
        hex.push(b);
      }
    }

    const out: number[] = [];
    for (let i = 0; i < hex.length; i += 2) {
      const hi = this.hexVal(hex[i]);
      const lo = (i + 1 < hex.length) ? this.hexVal(hex[i + 1]) : 0;
      if (hi >= 0 && lo >= 0) {
        out.push((hi << 4) | lo);
      }
    }

    return this.decodeStringBytes(new Uint8Array(out));
  }

  private hexVal(c: number): number {
    if (c >= 0x30 && c <= 0x39) return c - 0x30;
    if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10;
    if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10;
    return -1;
  }

  private decodeStringBytes(bytes: Uint8Array): string {
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      let str = '';
      for (let i = 2; i < bytes.length; i += 2) {
        const hi = bytes[i];
        const lo = i + 1 < bytes.length ? bytes[i + 1] : 0;
        str += String.fromCharCode((hi << 8) | lo);
      }
      return str;
    }
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
      let str = '';
      for (let i = 2; i < bytes.length; i += 2) {
        const lo = bytes[i];
        const hi = i + 1 < bytes.length ? bytes[i + 1] : 0;
        str += String.fromCharCode((hi << 8) | lo);
      }
      return str;
    }
    let res = '';
    for (let i = 0; i < bytes.length; i++) {
      res += String.fromCharCode(bytes[i]);
    }
    return res;
  }

  private readName(): PDFName {
    this.pos++; // skip '/'
    let name = '';
    while (this.pos < this.length) {
      const b = this.buffer[this.pos];
      if (this.isDelimiter(b)) break;
      if (b === 0x23 && this.pos + 2 < this.length) { // # hex
        const hi = this.hexVal(this.buffer[this.pos + 1]);
        const lo = this.hexVal(this.buffer[this.pos + 2]);
        if (hi >= 0 && lo >= 0) {
          name += String.fromCharCode((hi << 4) | lo);
          this.pos += 3;
          continue;
        }
      }
      name += String.fromCharCode(b);
      this.pos++;
    }
    return { name };
  }

  private readWordOrNumber(startPos: number): Token {
    let word = '';
    while (this.pos < this.length) {
      const b = this.buffer[this.pos];
      if (this.isDelimiter(b)) break;
      word += String.fromCharCode(b);
      this.pos++;
    }

    if (/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(word)) {
      return { type: TokenType.Number, value: parseFloat(word), pos: startPos };
    }

    if (word === 'true') return { type: TokenType.Keyword, value: true, pos: startPos };
    if (word === 'false') return { type: TokenType.Keyword, value: false, pos: startPos };
    if (word === 'null') return { type: TokenType.Keyword, value: null, pos: startPos };

    return { type: TokenType.Keyword, value: word, pos: startPos };
  }

  readStreamData(length: number): Uint8Array {
    while (this.pos < this.length && (this.buffer[this.pos] === 0x20 || this.buffer[this.pos] === 0x09)) {
      this.pos++;
    }
    if (this.pos < this.length && this.buffer[this.pos] === 0x0d) this.pos++;
    if (this.pos < this.length && this.buffer[this.pos] === 0x0a) this.pos++;

    const start = this.pos;
    let end = start + length;

    if (length > 0 && end <= this.length) {
      this.pos = end;
      return this.buffer.slice(start, end);
    }

    const endMarker = [0x65, 0x6e, 0x64, 0x73, 0x74, 0x72, 0x65, 0x61, 0x6d]; // 'endstream'
    let idx = start;
    while (idx < this.length - 8) {
      let match = true;
      for (let i = 0; i < 9; i++) {
        if (this.buffer[idx + i] !== endMarker[i]) {
          match = false;
          break;
        }
      }
      if (match) {
        let streamEnd = idx;
        if (streamEnd > start && this.buffer[streamEnd - 1] === 0x0a) streamEnd--;
        if (streamEnd > start && this.buffer[streamEnd - 1] === 0x0d) streamEnd--;
        this.pos = idx;
        return this.buffer.slice(start, streamEnd);
      }
      idx++;
    }

    this.pos = this.length;
    return this.buffer.slice(start);
  }
}
