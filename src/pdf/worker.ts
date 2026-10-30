import { PDFDocument } from './document';

let currentDoc: PDFDocument | null = null;
let currentBuffer: Uint8Array | null = null;

self.onmessage = async (e: MessageEvent) => {
  const { id, type, buffer, pageIndex, scale, width, height } = e.data;

  if (type === 'init') {
    try {
      currentBuffer = buffer;
      currentDoc = new PDFDocument(currentBuffer!);
      await currentDoc.load();
      self.postMessage({ id, type: 'init_ok', pageCount: currentDoc.pages.length });
    } catch (err: any) {
      self.postMessage({ id, type: 'error', error: err?.message || String(err) });
    }
    return;
  }

  if (type === 'render') {
    try {
      if (!currentDoc) {
        if (!buffer) throw new Error('Document not loaded in worker');
        currentDoc = new PDFDocument(buffer);
        await currentDoc.load();
      }

      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not get 2D context in worker');

      const textItems = await currentDoc.renderPage(pageIndex, ctx as any, scale);
      const imageBitmap = canvas.transferToImageBitmap();

      (self as any).postMessage(
        {
          id,
          type: 'render_ok',
          pageIndex,
          scale,
          imageBitmap,
          textItems,
        },
        [imageBitmap]
      );
    } catch (err: any) {
      self.postMessage({ id, type: 'error', pageIndex, error: err?.message || String(err) });
    }
  }
};
