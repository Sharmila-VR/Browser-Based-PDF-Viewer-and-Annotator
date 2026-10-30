import { describe, it, expect } from 'vitest';
import { PDFParser } from '../pdf/parser';
import { PDFDocument } from '../pdf/document';
import { createCorruptedSamplePdf } from '../samples/samplePdf';

describe('XRef Recovery', () => {
  it('reconstructs xref table and resolves objects from corrupted PDF', async () => {
    const corruptData = createCorruptedSamplePdf();
    const parser = new PDFParser(corruptData);

    await parser.parse();

    expect(parser.xref.size).toBeGreaterThan(0);
    expect(parser.trailer['Root']).toBeDefined();

    const root = await parser.resolve(parser.trailer['Root']);
    expect(root).toBeDefined();
    expect((root as any)['Pages']).toBeDefined();
  });

  it('loads corrupted document cleanly through PDFDocument without errors', async () => {
    const corruptData = createCorruptedSamplePdf();
    const doc = new PDFDocument(corruptData);

    await doc.load();

    expect(doc.pages.length).toBe(2);
    expect(doc.pages[0].mediaBox).toEqual([0, 0, 612, 792]);

    const textItems = await doc.extractPageText(0);
    expect(textItems.length).toBeGreaterThan(0);
    expect(textItems.some((t) => t.str.includes('Client-Side'))).toBe(true);
  });
});
