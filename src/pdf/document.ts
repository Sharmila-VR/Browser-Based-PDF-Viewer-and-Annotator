import { PDFParser } from './parser';
import { PDFFontHandler } from './font';
import { ContentInterpreter } from './content';
import { IncrementalUpdater } from './incremental';
import { Annotation, OutlineItem, PageInfo, PDFObject, PDFRef, PDFStream, SearchMatch, TextItem } from './types';
import { decompressFlate } from './decompress';

export class PDFDocument {
  public parser: PDFParser;
  public fontHandler: PDFFontHandler;
  public pages: PageInfo[] = [];
  public outlines: OutlineItem[] = [];
  public annotations: Map<number, Annotation[]> = new Map();
  private originalStartXRef: number = 0;
  private pageTextCache: Map<number, TextItem[]> = new Map();

  constructor(buffer: Uint8Array) {
    this.parser = new PDFParser(buffer);
    this.fontHandler = new PDFFontHandler(this.parser);
  }

  async load(): Promise<void> {
    await this.parser.parse();
    this.originalStartXRef = this.findStartXRef();
    await this.loadPages();
    await this.loadOutlines();
  }

  private findStartXRef(): number {
    const searchLen = Math.min(this.parser.buffer.length, 4096);
    const startPos = this.parser.buffer.length - searchLen;
    const sub = this.parser.buffer.subarray(startPos);
    const text = new TextDecoder('latin1').decode(sub);
    const match = text.lastIndexOf('startxref');
    if (match === -1) return 0;
    const after = text.substring(match + 9);
    const numMatch = after.match(/\s*(\d+)/);
    return numMatch ? parseInt(numMatch[1], 10) : 0;
  }

  private async loadPages(): Promise<void> {
    const rootRef = this.parser.trailer['Root'];
    const catalog = (await this.parser.resolve(rootRef)) as Record<string, PDFObject>;
    if (!catalog) {
      throw new Error('Invalid PDF catalog');
    }

    const pagesRoot = catalog['Pages'];
    this.pages = [];
    await this.traversePageTree(pagesRoot, {
      mediaBox: [0, 0, 612, 792],
      cropBox: [0, 0, 612, 792],
      rotate: 0,
      resources: {},
    });
  }

  private async traversePageTree(
    nodeRef: PDFObject,
    inherited: {
      mediaBox: [number, number, number, number];
      cropBox: [number, number, number, number];
      rotate: number;
      resources: Record<string, PDFObject>;
    }
  ): Promise<void> {
    const node = (await this.parser.resolve(nodeRef)) as Record<string, PDFObject>;
    if (!node) return;

    const type = this.parser.getNameValue(node['Type']);

    const currentMediaBox = (node['MediaBox'] as [number, number, number, number]) || inherited.mediaBox;
    const currentCropBox = (node['CropBox'] as [number, number, number, number]) || currentMediaBox || inherited.cropBox;
    const currentRotate = typeof node['Rotate'] === 'number' ? node['Rotate'] : inherited.rotate;
    const currentResources = (await this.parser.resolve(node['Resources'] || inherited.resources)) as Record<string, PDFObject> || {};

    if (type === 'Pages') {
      const kids = (await this.parser.resolve(node['Kids'])) as PDFObject[];
      if (Array.isArray(kids)) {
        for (const kid of kids) {
          await this.traversePageTree(kid, {
            mediaBox: currentMediaBox,
            cropBox: currentCropBox,
            rotate: currentRotate,
            resources: currentResources,
          });
        }
      }
    } else if (type === 'Page' || !type) {
      const pageIndex = this.pages.length;
      const objNum = this.parser.isRef(nodeRef) ? nodeRef.num : pageIndex + 1;

      const pageInfo: PageInfo = {
        index: pageIndex,
        objNum,
        dict: node,
        mediaBox: currentMediaBox,
        cropBox: currentCropBox,
        rotate: currentRotate,
        resources: currentResources,
        contents: node['Contents'],
      };

      this.pages.push(pageInfo);
      await this.loadExistingAnnotations(pageIndex, node);
    }
  }

  private async loadExistingAnnotations(pageIndex: number, pageDict: Record<string, PDFObject>): Promise<void> {
    if (!pageDict['Annots']) return;
    const annotsRef = await this.parser.resolve(pageDict['Annots']);
    if (!Array.isArray(annotsRef)) return;

    const list: Annotation[] = [];

    for (const item of annotsRef) {
      const annot = (await this.parser.resolve(item)) as Record<string, PDFObject>;
      if (!annot || typeof annot !== 'object') continue;

      const subtype = this.parser.getNameValue(annot['Subtype']);
      const rect = (annot['Rect'] as [number, number, number, number]) || [0, 0, 100, 100];
      const contents = typeof annot['Contents'] === 'string' ? annot['Contents'] : '';
      const author = typeof annot['T'] === 'string' ? annot['T'] : undefined;
      const c = annot['C'] as number[];
      const color = c && c.length >= 3
        ? `#${Math.round(c[0] * 255).toString(16).padStart(2, '0')}${Math.round(c[1] * 255).toString(16).padStart(2, '0')}${Math.round(c[2] * 255).toString(16).padStart(2, '0')}`
        : '#ffe066';

      const base = {
        id: 'annot_' + Math.random().toString(36).substring(2, 9),
        pageIndex,
        color,
        rect,
        author,
        contents,
        createdAt: Date.now(),
        modifiedAt: Date.now(),
      };

      if (subtype === 'Highlight') {
        list.push({ ...base, type: 'highlight' });
      } else if (subtype === 'Underline') {
        list.push({ ...base, type: 'underline' });
      } else if (subtype === 'Text') {
        list.push({ ...base, type: 'note', contents });
      } else if (subtype === 'Square') {
        list.push({ ...base, type: 'rect', strokeWidth: 2 });
      } else if (subtype === 'Ink') {
        const rawPaths = annot['InkList'] as number[][][];
        const paths: Array<Array<{ x: number; y: number }>> = [];
        if (Array.isArray(rawPaths)) {
          for (const p of rawPaths) {
            const pathPts: Array<{ x: number; y: number }> = [];
            for (let i = 0; i < p.length; i += 2) {
              pathPts.push({ x: (p as any)[i], y: (p as any)[i + 1] });
            }
            paths.push(pathPts);
          }
        }
        list.push({ ...base, type: 'ink', paths, strokeWidth: 2 });
      }
    }

    if (list.length > 0) {
      this.annotations.set(pageIndex, list);
    }
  }

  private async loadOutlines(): Promise<void> {
    const rootRef = this.parser.trailer['Root'];
    const catalog = (await this.parser.resolve(rootRef)) as Record<string, PDFObject>;
    if (!catalog || !catalog['Outlines']) return;

    const outlinesDict = (await this.parser.resolve(catalog['Outlines'])) as Record<string, PDFObject>;
    if (!outlinesDict || !outlinesDict['First']) return;

    this.outlines = await this.readOutlineChain(outlinesDict['First']);
  }

  private async readOutlineChain(firstRef: PDFObject): Promise<OutlineItem[]> {
    const items: OutlineItem[] = [];
    let currentRef: PDFObject | undefined = firstRef;

    while (currentRef) {
      const item = (await this.parser.resolve(currentRef)) as Record<string, PDFObject>;
      if (!item) break;

      const title = typeof item['Title'] === 'string' ? item['Title'] : 'Untitled';
      const dest = item['Dest'];
      let pageIndex: number | undefined;

      if (dest) {
        pageIndex = await this.resolveDestPageIndex(dest);
      }

      let children: OutlineItem[] | undefined;
      if (item['First']) {
        children = await this.readOutlineChain(item['First']);
      }

      items.push({ title, dest, pageIndex, children });
      currentRef = item['Next'];
    }

    return items;
  }

  private async resolveDestPageIndex(dest: PDFObject): Promise<number | undefined> {
    const resolved = await this.parser.resolve(dest);
    if (Array.isArray(resolved) && resolved.length > 0) {
      const targetPageRef = resolved[0];
      if (this.parser.isRef(targetPageRef)) {
        for (let i = 0; i < this.pages.length; i++) {
          if (this.pages[i].objNum === targetPageRef.num) {
            return i;
          }
        }
      }
    }
    return undefined;
  }

  async getPageContentBytes(pageIndex: number): Promise<Uint8Array> {
    const page = this.pages[pageIndex];
    if (!page || !page.contents) return new Uint8Array(0);

    const contentsRef = await this.parser.resolve(page.contents);

    if (Array.isArray(contentsRef)) {
      const chunks: Uint8Array[] = [];
      let totalLen = 0;
      for (const ref of contentsRef) {
        const stream = (await this.parser.resolve(ref)) as PDFStream;
        if (stream && stream.data) {
          const dec = await decompressFlate(stream.data, stream.dict?.['DecodeParms'] as any);
          chunks.push(dec);
          totalLen += dec.length;
        }
      }
      const combined = new Uint8Array(totalLen);
      let offset = 0;
      for (const ch of chunks) {
        combined.set(ch, offset);
        offset += ch.length;
      }
      return combined;
    }

    const stream = contentsRef as PDFStream;
    if (stream && stream.data) {
      return await decompressFlate(stream.data, stream.dict?.['DecodeParms'] as any);
    }

    return new Uint8Array(0);
  }

  async renderPage(pageIndex: number, ctx: CanvasRenderingContext2D, scale = 1.0): Promise<TextItem[]> {
    const page = this.pages[pageIndex];
    if (!page) return [];

    const cropBox = page.cropBox || page.mediaBox || [0, 0, 612, 792];
    const width = cropBox[2] - cropBox[0];
    const height = cropBox[3] - cropBox[1];

    ctx.save();
    ctx.scale(scale, scale);

    if (page.rotate === 90) {
      ctx.translate(height, 0);
      ctx.rotate((90 * Math.PI) / 180);
    } else if (page.rotate === 180) {
      ctx.translate(width, height);
      ctx.rotate((180 * Math.PI) / 180);
    } else if (page.rotate === 270) {
      ctx.translate(0, width);
      ctx.rotate((270 * Math.PI) / 180);
    }

    ctx.translate(-cropBox[0], -cropBox[1]);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cropBox[0], cropBox[1], width, height);

    ctx.translate(0, cropBox[3] + cropBox[1]);
    ctx.scale(1, -1);

    const contentBytes = await this.getPageContentBytes(pageIndex);
    const interpreter = new ContentInterpreter(this.parser, this.fontHandler, page.resources);
    const textItems = await interpreter.execute(contentBytes, ctx);

    ctx.restore();

    this.pageTextCache.set(pageIndex, textItems);
    return textItems;
  }

  async extractPageText(pageIndex: number): Promise<TextItem[]> {
    if (this.pageTextCache.has(pageIndex)) {
      return this.pageTextCache.get(pageIndex)!;
    }
    const page = this.pages[pageIndex];
    if (!page) return [];

    const contentBytes = await this.getPageContentBytes(pageIndex);
    const interpreter = new ContentInterpreter(this.parser, this.fontHandler, page.resources);
    const textItems = await interpreter.execute(contentBytes, null);
    this.pageTextCache.set(pageIndex, textItems);
    return textItems;
  }

  async search(query: string): Promise<SearchMatch[]> {
    if (!query || query.trim() === '') return [];
    const q = query.toLowerCase();
    const results: SearchMatch[] = [];

    for (let pageIdx = 0; pageIdx < this.pages.length; pageIdx++) {
      const items = await this.extractPageText(pageIdx);
      let pageFullText = '';
      const charToItemMap: number[] = [];

      for (let itemIdx = 0; itemIdx < items.length; itemIdx++) {
        const str = items[itemIdx].str;
        for (let c = 0; c < str.length; c++) {
          charToItemMap.push(itemIdx);
        }
        pageFullText += str + ' ';
        charToItemMap.push(-1);
      }

      const lowerFullText = pageFullText.toLowerCase();
      let matchIdx = 0;
      let pos = 0;

      while ((pos = lowerFullText.indexOf(q, pos)) !== -1) {
        const itemIndex = charToItemMap[pos];
        const matchedItem = itemIndex >= 0 ? items[itemIndex] : items[0];

        const contextStart = Math.max(0, pos - 20);
        const contextEnd = Math.min(pageFullText.length, pos + q.length + 20);
        const context = '...' + pageFullText.substring(contextStart, contextEnd) + '...';

        results.push({
          pageIndex: pageIdx,
          textIndex: itemIndex,
          matchIndex: matchIdx++,
          str: pageFullText.substring(pos, pos + q.length),
          rect: matchedItem ? [matchedItem.x, matchedItem.y, matchedItem.x + matchedItem.width, matchedItem.y + matchedItem.height] : [0, 0, 100, 20],
          context,
        });

        pos += q.length;
      }
    }

    return results;
  }

  saveWithAnnotations(): Uint8Array {
    const updater = new IncrementalUpdater(this.parser);
    return updater.save(this.pages, this.annotations, this.originalStartXRef);
  }
}
