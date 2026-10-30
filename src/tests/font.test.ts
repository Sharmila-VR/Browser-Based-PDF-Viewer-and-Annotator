import { describe, it, expect } from 'vitest';
import { PDFFontHandler } from '../pdf/font';
import { PDFParser } from '../pdf/parser';

describe('PDFFontHandler', () => {
  it('loads standard fonts and maps character codes', async () => {
    const parser = new PDFParser(new Uint8Array(0));
    const handler = new PDFFontHandler(parser);

    const font = await handler.loadFont({
      Type: { name: 'Font' },
      Subtype: { name: 'Type1' },
      BaseFont: { name: 'Times-Roman' },
    });

    expect(font.baseFont).toBe('Times-Roman');
    expect(font.fontFamily).toContain('Times');

    const mapped = handler.mapCharCode(65, font);
    expect(mapped).toBe('A');

    const width = handler.getGlyphWidth(65, font);
    expect(width).toBeGreaterThan(0);
  });

  it('parses ToUnicode CMaps with beginbfchar and beginbfrange', async () => {
    const parser = new PDFParser(new Uint8Array(0));
    const handler = new PDFFontHandler(parser);

    const cmapStream = new TextEncoder().encode(`
      /CIDInit /ProcSet findresource begin
      12 dict begin
      begincmap
      /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
      /CMapName /Custom-ToUnicode def
      /CMapType 2 def
      1 beginbfrange
      <0001> <0003> <0041>
      endbfrange
      2 beginbfchar
      <000A> <005A>
      <0020> <0020>
      endbfchar
      endcmap
      CMapName currentdict /CMap defineresource pop
      end
      end
    `);

    const font = await handler.loadFont({
      Type: { name: 'Font' },
      Subtype: { name: 'Type0' },
      BaseFont: { name: 'CustomFont' },
      ToUnicode: {
        dict: { Length: cmapStream.length },
        data: cmapStream,
      },
    });

    expect(font.toUnicode).toBeDefined();
    // 0x0001 -> 'A' (0x0041)
    expect(font.toUnicode!.get(1)).toBe('A');
    // 0x0002 -> 'B' (0x0042)
    expect(font.toUnicode!.get(2)).toBe('B');
    // 0x0003 -> 'C' (0x0043)
    expect(font.toUnicode!.get(3)).toBe('C');
    // 0x000A -> 'Z' (0x005A)
    expect(font.toUnicode!.get(10)).toBe('Z');

    expect(handler.mapCharCode(1, font)).toBe('A');
    expect(handler.mapCharCode(10, font)).toBe('Z');
  });

  it('handles font widths array', async () => {
    const parser = new PDFParser(new Uint8Array(0));
    const handler = new PDFFontHandler(parser);

    const font = await handler.loadFont({
      Type: { name: 'Font' },
      Subtype: { name: 'TrueType' },
      BaseFont: { name: 'Helvetica' },
      FirstChar: 65,
      LastChar: 67,
      Widths: [700, 650, 720],
    });

    expect(handler.getGlyphWidth(65, font)).toBe(700);
    expect(handler.getGlyphWidth(66, font)).toBe(650);
    expect(handler.getGlyphWidth(67, font)).toBe(720);
    expect(handler.getGlyphWidth(32, font)).toBe(250);
  });
});
