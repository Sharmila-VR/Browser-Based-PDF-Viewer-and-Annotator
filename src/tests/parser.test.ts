import { describe, it, expect } from 'vitest';
import { PDFLexer, TokenType } from '../pdf/lexer';
import { PDFParser } from '../pdf/parser';
import { createSamplePdf } from '../samples/samplePdf';

describe('PDFLexer', () => {
  it('tokenizes numbers, names, keywords, and strings', () => {
    const raw = new TextEncoder().encode('/Title (Hello World) 123.45 true [ 1 2 ] << /Key <4142> >>');
    const lexer = new PDFLexer(raw);

    const t1 = lexer.nextToken();
    expect(t1.type).toBe(TokenType.Name);
    expect(t1.value.name).toBe('Title');

    const t2 = lexer.nextToken();
    expect(t2.type).toBe(TokenType.String);
    expect(t2.value).toBe('Hello World');

    const t3 = lexer.nextToken();
    expect(t3.type).toBe(TokenType.Number);
    expect(t3.value).toBe(123.45);

    const t4 = lexer.nextToken();
    expect(t4.type).toBe(TokenType.Keyword);
    expect(t4.value).toBe(true);

    const t5 = lexer.nextToken();
    expect(t5.type).toBe(TokenType.ArrayOpen);

    const t6 = lexer.nextToken();
    expect(t6.value).toBe(1);

    const t7 = lexer.nextToken();
    expect(t7.value).toBe(2);

    const t8 = lexer.nextToken();
    expect(t8.type).toBe(TokenType.ArrayClose);

    const t9 = lexer.nextToken();
    expect(t9.type).toBe(TokenType.DictOpen);

    const t10 = lexer.nextToken();
    expect(t10.value.name).toBe('Key');

    const t11 = lexer.nextToken();
    expect(t11.type).toBe(TokenType.String);
    expect(t11.value).toBe('AB');
  });

  it('handles escape sequences in strings', () => {
    const raw = new TextEncoder().encode('(Line1\\nLine2\\t\\r\\b\\f\\\\\\(Escaped\\)\\101) % comment\n<414>');
    const lexer = new PDFLexer(raw);
    const tok = lexer.nextToken();
    expect(tok.value).toContain('Line1\nLine2');
    expect(tok.value).toContain('A');

    const hexTok = lexer.nextToken();
    expect(hexTok.type).toBe(TokenType.String);
    expect(hexTok.value).toBe('A@');
  });

  it('handles UTF-16BE decoded strings with BOM', () => {
    const raw = new Uint8Array([0x28, 0xfe, 0xff, 0x00, 0x41, 0x00, 0x42, 0x29]); // (FEFF 0041 0042) -> 'AB'
    const lexer = new PDFLexer(raw);
    const tok = lexer.nextToken();
    expect(tok.value).toBe('AB');
  });

  it('handles names with hex hash escapes', () => {
    const raw = new TextEncoder().encode('/A#20B false null');
    const lexer = new PDFLexer(raw);
    const n = lexer.nextToken();
    expect(n.value.name).toBe('A B');
    const f = lexer.nextToken();
    expect(f.value).toBe(false);
    const nl = lexer.nextToken();
    expect(nl.value).toBe(null);
  });

  it('reads stream data correctly with readStreamData', () => {
    const raw = new TextEncoder().encode('stream\r\nHello World\r\nendstream');
    const lexer = new PDFLexer(raw);
    lexer.nextToken(); // stream
    const data = lexer.readStreamData(11);
    expect(new TextDecoder().decode(data)).toBe('Hello World');
  });
});

describe('PDFParser', () => {
  it('parses valid PDF structure, xref table, and trailer', async () => {
    const pdfData = createSamplePdf(2);
    const parser = new PDFParser(pdfData);
    await parser.parse();

    expect(parser.xref.size).toBeGreaterThan(0);
    expect(parser.trailer['Root']).toBeDefined();

    const root = await parser.resolve(parser.trailer['Root']);
    expect(root).toBeDefined();
    expect(typeof root).toBe('object');
  });

  it('fetches and resolves indirect objects correctly', async () => {
    const pdfData = createSamplePdf(1);
    const parser = new PDFParser(pdfData);
    await parser.parse();

    const obj1 = await parser.fetchObject(1);
    expect(obj1).toBeDefined();
    expect(typeof obj1).toBe('object');

    const pages = await parser.resolve((obj1 as any)['Pages']);
    expect(pages).toBeDefined();
    expect((pages as any)['Count']).toBe(1);
  });

  it('reads object streams (/Type /ObjStm)', async () => {
    const parser = new PDFParser(new Uint8Array(0));
    // Simulated object stream containing 2 objects: obj 10: 1234, obj 11: /Test
    // First line of stream: "10 0 11 5" (pairs of objNum offset)
    const streamContent = new TextEncoder().encode('10 0 11 5 1234 /Test');
    const objStm = {
      dict: {
        Type: { name: 'ObjStm' },
        N: 2,
        First: 10,
        Length: streamContent.length,
      },
      data: streamContent,
    };

    parser.resolvedObjects.set(20, objStm as any);
    parser.xref.set(10, { offset: 0, gen: 0, free: false, inStream: true, streamObjNum: 20, streamIndex: 0 });
    parser.xref.set(11, { offset: 0, gen: 0, free: false, inStream: true, streamObjNum: 20, streamIndex: 1 });

    const obj10 = await parser.fetchObject(10);
    expect(obj10).toBe(1234);

    const obj11 = await parser.fetchObject(11);
    expect(parser.getNameValue(obj11)).toBe('Test');
  });
});
