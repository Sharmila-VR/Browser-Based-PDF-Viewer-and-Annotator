import { PDFLexer, TokenType } from './lexer';
import { PDFName, PDFObject, PDFRef, PDFStream, XRefEntry } from './types';
import { decompressFlate } from './decompress';

export class PDFParser {
  public buffer: Uint8Array;
  public xref: Map<number, XRefEntry> = new Map();
  public trailer: Record<string, PDFObject> = {};
  public resolvedObjects: Map<number, PDFObject> = new Map();
  private objectStreamCache: Map<number, Map<number, PDFObject>> = new Map();

  constructor(buffer: Uint8Array) {
    this.buffer = buffer;
  }

  async parse(): Promise<void> {
    try {
      await this.readStructure();
    } catch {
      await this.recoverXRef();
    }

    if (!this.trailer['Root']) {
      await this.recoverXRef();
    }
  }

  private async readStructure(): Promise<void> {
    const startXRefOffset = this.findStartXRef();
    if (startXRefOffset < 0 || startXRefOffset >= this.buffer.length) {
      throw new Error('Invalid startxref offset');
    }

    let nextOffset: number | null = startXRefOffset;
    const visited = new Set<number>();

    while (nextOffset !== null && nextOffset > 0 && nextOffset < this.buffer.length) {
      if (visited.has(nextOffset)) break;
      visited.add(nextOffset);

      const lexer = new PDFLexer(this.buffer, nextOffset);
      lexer.skipWhitespaceAndComments();
      const token = lexer.nextToken();

      if (token.type === TokenType.Keyword && token.value === 'xref') {
        const trailerDict = await this.readClassicXRef(lexer);
        if (Object.keys(this.trailer).length === 0) {
          this.trailer = trailerDict;
        }
        const prev = trailerDict['Prev'];
        nextOffset = typeof prev === 'number' ? prev : null;
      } else if (token.type === TokenType.Number) {
        const objNum = token.value;
        const genToken = lexer.nextToken();
        const objToken = lexer.nextToken();
        if (objToken.type === TokenType.Keyword && objToken.value === 'obj') {
          const streamObj = await this.parseDirectObject(lexer);
          if (this.isStream(streamObj) && this.getNameValue(streamObj.dict['Type']) === 'XRef') {
            await this.readXRefStream(streamObj);
            if (Object.keys(this.trailer).length === 0) {
              this.trailer = streamObj.dict;
            }
            const prev = streamObj.dict['Prev'];
            nextOffset = typeof prev === 'number' ? prev : null;
          } else {
            throw new Error('Expected XRef stream');
          }
        } else {
          throw new Error('Invalid xref format');
        }
      } else {
        throw new Error('Unknown xref structure');
      }
    }
  }

  private findStartXRef(): number {
    const searchLen = Math.min(this.buffer.length, 4096);
    const startPos = this.buffer.length - searchLen;
    const sub = this.buffer.subarray(startPos);
    const text = new TextDecoder('latin1').decode(sub);
    const match = text.lastIndexOf('startxref');
    if (match === -1) return -1;

    const after = text.substring(match + 9);
    const numMatch = after.match(/\s*(\d+)/);
    if (!numMatch) return -1;
    return parseInt(numMatch[1], 10);
  }

  private async readClassicXRef(lexer: PDFLexer): Promise<Record<string, PDFObject>> {
    while (true) {
      lexer.skipWhitespaceAndComments();
      const t = lexer.nextToken();
      if (t.type === TokenType.Keyword && t.value === 'trailer') {
        break;
      }
      if (t.type !== TokenType.Number) {
        break;
      }

      const firstObj = t.value;
      const countToken = lexer.nextToken();
      const count = countToken.value;

      for (let i = 0; i < count; i++) {
        lexer.skipWhitespaceAndComments();
        const offsetToken = lexer.nextToken();
        const genToken = lexer.nextToken();
        const flagToken = lexer.nextToken();

        const objNum = firstObj + i;
        if (!this.xref.has(objNum)) {
          this.xref.set(objNum, {
            offset: offsetToken.value,
            gen: genToken.value,
            free: flagToken.value === 'f',
          });
        }
      }
    }

    const trailerObj = await this.parseDirectObject(lexer);
    return typeof trailerObj === 'object' && trailerObj !== null && !('num' in trailerObj) && !('data' in trailerObj)
      ? (trailerObj as Record<string, PDFObject>)
      : {};
  }

  private async readXRefStream(stream: PDFStream): Promise<void> {
    const dict = stream.dict;
    const w = (dict['W'] as number[]) || [1, 2, 1];
    const size = (dict['Size'] as number) || 0;
    const index = (dict['Index'] as number[]) || [0, size];

    const decoded = await decompressFlate(stream.data, dict['DecodeParms'] as any);
    let offset = 0;

    for (let s = 0; s < index.length; s += 2) {
      const startObj = index[s];
      const count = index[s + 1];

      for (let i = 0; i < count; i++) {
        const objNum = startObj + i;
        let type = 1;
        if (w[0] > 0) {
          type = 0;
          for (let b = 0; b < w[0]; b++) {
            type = (type << 8) | decoded[offset++];
          }
        }

        let f2 = 0;
        for (let b = 0; b < w[1]; b++) {
          f2 = (f2 << 8) | decoded[offset++];
        }

        let f3 = 0;
        for (let b = 0; b < w[2]; b++) {
          f3 = (f3 << 8) | decoded[offset++];
        }

        if (!this.xref.has(objNum)) {
          if (type === 0) {
            this.xref.set(objNum, { offset: f2, gen: f3, free: true });
          } else if (type === 1) {
            this.xref.set(objNum, { offset: f2, gen: f3, free: false });
          } else if (type === 2) {
            this.xref.set(objNum, {
              offset: 0,
              gen: 0,
              free: false,
              inStream: true,
              streamObjNum: f2,
              streamIndex: f3,
            });
          }
        }
      }
    }
  }

  async recoverXRef(): Promise<void> {
    this.xref.clear();
    const text = new TextDecoder('latin1').decode(this.buffer);

    const objRegex = /(\d+)\s+(\d+)\s+obj\b/g;
    let match: RegExpExecArray | null;

    while ((match = objRegex.exec(text)) !== null) {
      const objNum = parseInt(match[1], 10);
      const gen = parseInt(match[2], 10);
      const offset = match.index;

      if (!this.xref.has(objNum)) {
        this.xref.set(objNum, {
          offset,
          gen,
          free: false,
        });
      }
    }

    let rootRef: PDFRef | null = null;
    const catalogRegex = /\/Type\s*\/Catalog/g;
    while ((match = catalogRegex.exec(text)) !== null) {
      const sliceStart = Math.max(0, match.index - 500);
      const slice = text.substring(sliceStart, match.index);
      const objMatch = slice.match(/(\d+)\s+(\d+)\s+obj/g);
      if (objMatch && objMatch.length > 0) {
        const last = objMatch[objMatch.length - 1];
        const parts = last.split(/\s+/);
        rootRef = { num: parseInt(parts[0], 10), gen: parseInt(parts[1], 10) };
        break;
      }
    }

    if (!rootRef) {
      for (const [num] of this.xref.entries()) {
        try {
          const obj = await this.fetchObject(num);
          if (obj && typeof obj === 'object' && this.getNameValue((obj as any)['Type']) === 'Catalog') {
            rootRef = { num, gen: 0 };
            break;
          }
        } catch {
          // continue search
        }
      }
    }

    if (rootRef) {
      this.trailer['Root'] = rootRef;
    }
  }

  async fetchObject(num: number): Promise<PDFObject> {
    if (this.resolvedObjects.has(num)) {
      return this.resolvedObjects.get(num)!;
    }

    const entry = this.xref.get(num);
    if (!entry || entry.free) {
      return null;
    }

    if (entry.inStream && entry.streamObjNum !== undefined && entry.streamIndex !== undefined) {
      const obj = await this.readFromObjectStream(entry.streamObjNum, entry.streamIndex, num);
      this.resolvedObjects.set(num, obj);
      return obj;
    }

    const lexer = new PDFLexer(this.buffer, entry.offset);
    lexer.skipWhitespaceAndComments();

    const numToken = lexer.nextToken();
    const genToken = lexer.nextToken();
    const objToken = lexer.nextToken();

    if (objToken.type !== TokenType.Keyword || objToken.value !== 'obj') {
      return null;
    }

    const value = await this.parseDirectObject(lexer);
    this.resolvedObjects.set(num, value);
    return value;
  }

  private async readFromObjectStream(streamObjNum: number, index: number, targetObjNum: number): Promise<PDFObject> {
    if (!this.objectStreamCache.has(streamObjNum)) {
      const streamObj = await this.fetchObject(streamObjNum);
      if (!this.isStream(streamObj)) {
        throw new Error('Object stream is not a stream');
      }

      const dict = streamObj.dict;
      const n = (dict['N'] as number) || 0;
      const first = (dict['First'] as number) || 0;

      const decoded = await decompressFlate(streamObj.data, dict['DecodeParms'] as any);
      const lexer = new PDFLexer(decoded, 0);

      const objOffsets: Array<{ num: number; offset: number }> = [];
      for (let i = 0; i < n; i++) {
        const numToken = lexer.nextToken();
        const offsetToken = lexer.nextToken();
        objOffsets.push({ num: numToken.value, offset: offsetToken.value });
      }

      const streamMap = new Map<number, PDFObject>();
      for (let i = 0; i < n; i++) {
        const item = objOffsets[i];
        lexer.seek(first + item.offset);
        const obj = await this.parseDirectObject(lexer);
        streamMap.set(item.num, obj);
      }

      this.objectStreamCache.set(streamObjNum, streamMap);
    }

    const cache = this.objectStreamCache.get(streamObjNum)!;
    return cache.get(targetObjNum) ?? null;
  }

  async resolve<T = PDFObject>(obj: PDFObject): Promise<T> {
    if (this.isRef(obj)) {
      return (await this.fetchObject(obj.num)) as T;
    }
    return obj as T;
  }

  async parseDirectObject(lexer: PDFLexer): Promise<PDFObject> {
    lexer.skipWhitespaceAndComments();
    const token = lexer.nextToken();

    switch (token.type) {
      case TokenType.Number: {
        const savedPos = lexer.tell();
        const next1 = lexer.nextToken();
        if (next1.type === TokenType.Number) {
          const next2 = lexer.nextToken();
          if (next2.type === TokenType.Keyword && next2.value === 'R') {
            return { num: token.value, gen: next1.value } as PDFRef;
          }
        }
        lexer.seek(savedPos);
        return token.value;
      }

      case TokenType.String:
      case TokenType.Name:
        return token.value;

      case TokenType.Keyword:
        if (token.value === true || token.value === false || token.value === null) {
          return token.value;
        }
        return token.value;

      case TokenType.ArrayOpen: {
        const arr: PDFObject[] = [];
        while (true) {
          lexer.skipWhitespaceAndComments();
          if (lexer.peekByte() === 0x5d) { // ']'
            lexer.readByte();
            break;
          }
          const item = await this.parseDirectObject(lexer);
          arr.push(item);
        }
        return arr;
      }

      case TokenType.DictOpen: {
        const dict: Record<string, PDFObject> = {};
        while (true) {
          lexer.skipWhitespaceAndComments();
          if (lexer.peekByte() === 0x3e && lexer.buffer[lexer.tell() + 1] === 0x3e) { // '>>'
            lexer.seek(lexer.tell() + 2);
            break;
          }
          const keyToken = lexer.nextToken();
          if (keyToken.type === TokenType.EOF || (keyToken.type === TokenType.Keyword && keyToken.value === '>>')) {
            break;
          }
          const key = typeof keyToken.value === 'object' && keyToken.value !== null && 'name' in keyToken.value
            ? (keyToken.value as PDFName).name
            : String(keyToken.value);

          const val = await this.parseDirectObject(lexer);
          dict[key] = val;
        }

        const afterPos = lexer.tell();
        lexer.skipWhitespaceAndComments();
        const nextToken = lexer.nextToken();

        if (nextToken.type === TokenType.Keyword && nextToken.value === 'stream') {
          let length = dict['Length'];
          if (this.isRef(length)) {
            const resolvedLen = await this.fetchObject(length.num);
            length = typeof resolvedLen === 'number' ? resolvedLen : 0;
          }
          const data = lexer.readStreamData(typeof length === 'number' ? length : 0);
          return { dict, data, offset: afterPos } as PDFStream;
        } else {
          lexer.seek(afterPos);
          return dict;
        }
      }

      default:
        return token.value;
    }
  }

  isRef(obj: any): obj is PDFRef {
    return typeof obj === 'object' && obj !== null && 'num' in obj && 'gen' in obj;
  }

  isName(obj: any): obj is PDFName {
    return typeof obj === 'object' && obj !== null && 'name' in obj;
  }

  isStream(obj: any): obj is PDFStream {
    return typeof obj === 'object' && obj !== null && 'dict' in obj && 'data' in obj;
  }

  getNameValue(obj: any): string {
    if (typeof obj === 'string') return obj;
    if (this.isName(obj)) return obj.name;
    return '';
  }
}
