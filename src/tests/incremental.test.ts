import { describe, it, expect } from 'vitest';
import { PDFDocument } from '../pdf/document';
import { createSamplePdf } from '../samples/samplePdf';
import { Annotation } from '../pdf/types';

describe('Incremental Annotation Serialization', () => {
  it('serializes highlight, note, ink, and rect annotations and produces valid incremental update', async () => {
    const originalPdf = createSamplePdf(1);
    const doc = new PDFDocument(originalPdf);
    await doc.load();

    const annotations: Annotation[] = [
      {
        id: 'h1',
        type: 'highlight',
        pageIndex: 0,
        color: '#ffdd00',
        rect: [60, 720, 300, 750],
        contents: 'Important heading',
        author: 'Reviewer',
        createdAt: Date.now(),
        modifiedAt: Date.now(),
      },
      {
        id: 'n1',
        type: 'note',
        pageIndex: 0,
        color: '#3388ff',
        rect: [350, 700, 370, 720],
        contents: 'Sticky note comment',
        author: 'Reviewer',
        createdAt: Date.now(),
        modifiedAt: Date.now(),
      },
      {
        id: 'r1',
        type: 'rect',
        pageIndex: 0,
        color: '#ff3333',
        fillColor: '#ffeeee',
        strokeWidth: 2,
        rect: [50, 400, 250, 480],
        createdAt: Date.now(),
        modifiedAt: Date.now(),
      },
      {
        id: 'i1',
        type: 'ink',
        pageIndex: 0,
        color: '#10b981',
        strokeWidth: 3,
        rect: [100, 200, 200, 250],
        paths: [
          [{ x: 100, y: 200 }, { x: 150, y: 220 }, { x: 200, y: 250 }],
        ],
        createdAt: Date.now(),
        modifiedAt: Date.now(),
      },
    ];

    doc.annotations.set(0, annotations);

    const savedBytes = doc.saveWithAnnotations();
    expect(savedBytes.length).toBeGreaterThan(originalPdf.length);

    const savedText = new TextDecoder('latin1').decode(savedBytes);
    expect(savedText).toContain('/Subtype /Highlight');
    expect(savedText).toContain('/Subtype /Text');
    expect(savedText).toContain('/Subtype /Square');
    expect(savedText).toContain('/Subtype /Ink');
    expect(savedText).toContain('startxref');
    expect(savedText).toContain('%%EOF');

    const reloadedDoc = new PDFDocument(savedBytes);
    await reloadedDoc.load();

    expect(reloadedDoc.pages.length).toBe(1);
    const loadedAnnots = reloadedDoc.annotations.get(0);
    expect(loadedAnnots).toBeDefined();
    expect(loadedAnnots!.length).toBe(4);

    const loadedHighlight = loadedAnnots!.find((a) => a.type === 'highlight');
    expect(loadedHighlight).toBeDefined();
    expect(loadedHighlight!.contents).toBe('Important heading');

    const loadedNote = loadedAnnots!.find((a) => a.type === 'note');
    expect(loadedNote).toBeDefined();
    expect(loadedNote!.contents).toBe('Sticky note comment');
  });
});
