import { describe, it, expect } from 'vitest';
import { ContentInterpreter, identityMatrix, multiplyMatrix } from '../pdf/content';
import { PDFParser } from '../pdf/parser';
import { PDFFontHandler } from '../pdf/font';

describe('ContentInterpreter', () => {
  it('correctly multiplies transformation matrices', () => {
    const m1 = { a: 2, b: 0, c: 0, d: 2, e: 10, f: 20 };
    const m2 = { a: 1, b: 0, c: 0, d: 1, e: 5, f: 5 };
    const res = multiplyMatrix(m1, m2);

    expect(res.a).toBe(2);
    expect(res.d).toBe(2);
    expect(res.e).toBe(15);
    expect(res.f).toBe(25);
  });

  it('interprets color, path, and graphics state operators', async () => {
    const parser = new PDFParser(new Uint8Array(0));
    const fontHandler = new PDFFontHandler(parser);
    const interpreter = new ContentInterpreter(parser, fontHandler, {});

    const content = new TextEncoder().encode(`
      q
      0.5 0.5 0.5 rg
      0.1 0.2 0.3 RG
      2.5 w
      10 20 m
      100 200 l
      s
      Q
    `);

    await interpreter.execute(content, null);

    expect(interpreter.state.fillColor).toBe('#000000');
  });

  it('interprets curves, rectangles, line caps, line joins, and CMYK colors', async () => {
    const parser = new PDFParser(new Uint8Array(0));
    const fontHandler = new PDFFontHandler(parser);
    const interpreter = new ContentInterpreter(parser, fontHandler, {});

    const content = new TextEncoder().encode(`
      q
      0.1 0.2 0.3 0.4 k
      0.2 0.3 0.4 0.1 K
      1 J
      2 j
      4 M
      [5 2] 1 d
      10 10 50 60 re
      20 20 m
      30 40 50 60 70 80 c
      90 100 110 120 v
      130 140 150 160 y
      h
      B*
      W*
      n
    `);

    await interpreter.execute(content, null);
    expect(interpreter.state.lineCap).toBe('round');
    expect(interpreter.state.lineJoin).toBe('bevel');
    expect(interpreter.state.dashArray).toEqual([5, 2]);
    expect(interpreter.state.dashPhase).toBe(1);
  });

  it('interprets text positioning and extracts text items with coordinates', async () => {
    const parser = new PDFParser(new Uint8Array(0));
    const fontHandler = new PDFFontHandler(parser);
    const interpreter = new ContentInterpreter(parser, fontHandler, {});

    const content = new TextEncoder().encode(`
      BT
      /F1 16 Tf
      1 0 0 1 50 120 Tm
      (Hello World) Tj
      0 -24 Td
      [(Testing ) 100 (Kerning)] TJ
      ET
    `);

    const items = await interpreter.execute(content, null);

    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items[0].str).toBe('Hello World');
    expect(items[0].fontSize).toBe(16);
    expect(items[0].x).toBe(50);
    expect(items[0].y).toBe(120);

    const secondLine = items.slice(1).map((i) => i.str).join('');
    expect(secondLine).toContain('Testing');
    expect(secondLine).toContain('Kerning');
  });

  it('interprets text states Tc, Tw, Tz, TL, Tr, Ts, TD, T*, \', and "', async () => {
    const parser = new PDFParser(new Uint8Array(0));
    const fontHandler = new PDFFontHandler(parser);
    const interpreter = new ContentInterpreter(parser, fontHandler, {});

    const content = new TextEncoder().encode(`
      BT
      /F1 12 Tf
      2 Tc
      3 Tw
      110 Tz
      18 TL
      1 Tr
      5 Ts
      10 -20 TD
      (Line 1) Tj
      T*
      (Line 2) '
      4 2 (Line 3) "
      ET
    `);

    const items = await interpreter.execute(content, null);
    expect(items.length).toBe(3);
    expect(interpreter.state.charSpacing).toBe(2);
    expect(interpreter.state.wordSpacing).toBe(4);
    expect(interpreter.state.horizontalScale).toBe(110);
    expect(interpreter.state.renderMode).toBe(1);
    expect(interpreter.state.textRise).toBe(5);
  });

  it('interprets Form XObjects (Do operator)', async () => {
    const parser = new PDFParser(new Uint8Array(0));
    const fontHandler = new PDFFontHandler(parser);

    const formContent = new TextEncoder().encode(`
      BT
      /F1 14 Tf
      (Form Content Text) Tj
      ET
    `);

    const resources = {
      XObject: {
        Form1: {
          dict: {
            Type: { name: 'XObject' },
            Subtype: { name: 'Form' },
            Matrix: [1, 0, 0, 1, 0, 0],
            Length: formContent.length,
          },
          data: formContent,
        },
      },
    };

    const interpreter = new ContentInterpreter(parser, fontHandler, resources as any);
    const content = new TextEncoder().encode('/Form1 Do');

    const items = await interpreter.execute(content, null);
    expect(items.length).toBe(1);
    expect(items[0].str).toBe('Form Content Text');
  });
});
