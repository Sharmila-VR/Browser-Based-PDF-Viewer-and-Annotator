import { describe, it, expect } from 'vitest';
import { PDFDocument } from '../pdf/document';
import { createSamplePdf } from '../samples/samplePdf';

describe('PDFDocument Features', () => {
  it('loads multi-page document and extracts page dimensions', async () => {
    const pdfData = createSamplePdf(3);
    const doc = new PDFDocument(pdfData);
    await doc.load();

    expect(doc.pages.length).toBe(3);
    for (let i = 0; i < 3; i++) {
      expect(doc.pages[i].mediaBox).toEqual([0, 0, 612, 792]);
      expect(doc.pages[i].rotate).toBe(0);
    }
  });

  it('loads document outlines/bookmarks', async () => {
    const pdfData = createSamplePdf(3);
    const doc = new PDFDocument(pdfData);
    await doc.load();

    expect(doc.outlines.length).toBeGreaterThan(0);
    expect(doc.outlines[0].title).toBe('Chapter 1: Overview');
  });

  it('searches full-text across multiple pages with match context', async () => {
    const pdfData = createSamplePdf(3);
    const doc = new PDFDocument(pdfData);
    await doc.load();

    const matches = await doc.search('Client-Side');
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].pageIndex).toBe(0);
    expect(matches[0].context).toContain('Client-Side');

    const multiPageMatches = await doc.search('Page');
    expect(multiPageMatches.length).toBeGreaterThanOrEqual(3);
  });

  it('renders page to mock Canvas 2D context without crashing', async () => {
    const pdfData = createSamplePdf(1);
    const doc = new PDFDocument(pdfData);
    await doc.load();

    const mockCtx: any = {
      save: () => {},
      restore: () => {},
      scale: () => {},
      translate: () => {},
      rotate: () => {},
      transform: () => {},
      fillRect: () => {},
      strokeRect: () => {},
      fillText: () => {},
      stroke: () => {},
      fill: () => {},
      clip: () => {},
      setLineDash: () => {},
      createImageData: () => ({ data: new Uint8ClampedArray(16) }),
      drawImage: () => {},
    };

    const textItems = await doc.renderPage(0, mockCtx, 1.5);
    expect(textItems.length).toBeGreaterThan(0);
  });
});
