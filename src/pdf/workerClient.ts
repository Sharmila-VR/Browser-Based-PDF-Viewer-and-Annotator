import { PDFDocument } from './document';
import { TextItem } from './types';

export interface RenderResult {
  imageBitmap?: ImageBitmap;
  textItems: TextItem[];
}

export class WorkerRenderClient {
  private worker: Worker | null = null;
  private pendingRequests: Map<string, { resolve: (res: RenderResult) => void; reject: (err: any) => void }> = new Map();
  private reqId = 0;
  private isSupported = false;

  constructor() {
    if (typeof window !== 'undefined' && typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
      try {
        this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = this.handleMessage.bind(this);
        this.isSupported = true;
      } catch {
        this.worker = null;
        this.isSupported = false;
      }
    }
  }

  private handleMessage(e: MessageEvent) {
    const { id, type, imageBitmap, textItems, error } = e.data;
    const req = this.pendingRequests.get(id);
    if (!req) return;

    this.pendingRequests.delete(id);
    if (type === 'render_ok') {
      req.resolve({ imageBitmap, textItems });
    } else {
      req.reject(new Error(error || 'Worker render failed'));
    }
  }

  async initDocument(buffer: Uint8Array): Promise<void> {
    if (!this.worker || !this.isSupported) return;
    const id = 'init_' + ++this.reqId;
    return new Promise((resolve) => {
      const handler = (e: MessageEvent) => {
        if (e.data.id === id) {
          this.worker?.removeEventListener('message', handler);
          resolve();
        }
      };
      this.worker?.addEventListener('message', handler);
      this.worker?.postMessage({ id, type: 'init', buffer });
    });
  }

  async renderPage(
    doc: PDFDocument,
    pageIndex: number,
    scale: number,
    targetCanvas: HTMLCanvasElement
  ): Promise<TextItem[]> {
    const page = doc.pages[pageIndex];
    if (!page) return [];

    const cropBox = page.cropBox || page.mediaBox || [0, 0, 612, 792];
    const isRotated = page.rotate === 90 || page.rotate === 270;
    const pageWidth = isRotated ? (cropBox[3] - cropBox[1]) : (cropBox[2] - cropBox[0]);
    const pageHeight = isRotated ? (cropBox[2] - cropBox[0]) : (cropBox[3] - cropBox[1]);

    const pixelRatio = window.devicePixelRatio || 1;
    const width = Math.round(pageWidth * scale * pixelRatio);
    const height = Math.round(pageHeight * scale * pixelRatio);

    targetCanvas.width = width;
    targetCanvas.height = height;
    targetCanvas.style.width = `${Math.round(pageWidth * scale)}px`;
    targetCanvas.style.height = `${Math.round(pageHeight * scale)}px`;

    const ctx = targetCanvas.getContext('2d');
    if (!ctx) return [];

    if (this.worker && this.isSupported) {
      try {
        const id = 'render_' + ++this.reqId;
        const res = await new Promise<RenderResult>((resolve, reject) => {
          this.pendingRequests.set(id, { resolve, reject });
          this.worker!.postMessage({
            id,
            type: 'render',
            pageIndex,
            scale: scale * pixelRatio,
            width,
            height,
          });
        });

        if (res.imageBitmap) {
          ctx.drawImage(res.imageBitmap, 0, 0);
          res.imageBitmap.close();
          return res.textItems;
        }
      } catch {
        // Fall back to main thread on worker render failure
      }
    }

    // Direct main thread render fallback
    ctx.clearRect(0, 0, width, height);
    return await doc.renderPage(pageIndex, ctx, scale * pixelRatio);
  }

  destroy() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
