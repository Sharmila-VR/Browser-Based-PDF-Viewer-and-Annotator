import { PDFParser } from './parser';
import { Annotation, PageInfo, PDFRef } from './types';

export class IncrementalUpdater {
  private parser: PDFParser;

  constructor(parser: PDFParser) {
    this.parser = parser;
  }

  save(
    pages: PageInfo[],
    annotationsByPage: Map<number, Annotation[]>,
    originalStartXRef: number
  ): Uint8Array {
    let maxObjNum = 0;
    for (const [num] of this.parser.xref.entries()) {
      if (num > maxObjNum) maxObjNum = num;
    }

    const newObjects: Array<{ num: number; content: string }> = [];
    const updatedPageObjNums: number[] = [];

    for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
      const pageAnnots = annotationsByPage.get(pageIdx) || [];
      if (pageAnnots.length === 0) continue;

      const page = pages[pageIdx];
      const pageObjNum = page.objNum;
      updatedPageObjNums.push(pageObjNum);

      const annotRefs: string[] = [];

      for (const annot of pageAnnots) {
        maxObjNum++;
        const annotObjNum = maxObjNum;
        annotRefs.push(`${annotObjNum} 0 R`);

        const annotContent = this.serializeAnnotation(annotObjNum, annot);
        newObjects.push({ num: annotObjNum, content: annotContent });
      }

      const updatedPageContent = this.serializePageWithAnnots(page, annotRefs);
      newObjects.push({ num: pageObjNum, content: updatedPageContent });
    }

    if (newObjects.length === 0) {
      return this.parser.buffer;
    }

    newObjects.sort((a, b) => a.num - b.num);

    const encoder = new TextEncoder();
    const originalBytes = this.parser.buffer;
    let currentOffset = originalBytes.length;

    let updateText = '\n';
    currentOffset += 1;

    const objectOffsets = new Map<number, number>();

    for (const obj of newObjects) {
      objectOffsets.set(obj.num, currentOffset);
      const objHeader = `${obj.num} 0 obj\n`;
      const objBody = `${obj.content}\nendobj\n`;
      const fullObj = objHeader + objBody;
      updateText += fullObj;
      currentOffset += encoder.encode(fullObj).length;
    }

    const xrefOffset = currentOffset;
    let xrefText = 'xref\n';

    const objectIds = Array.from(objectOffsets.keys()).sort((a, b) => a - b);
    const contiguousRanges: Array<{ start: number; ids: number[] }> = [];

    let currentRange: { start: number; ids: number[] } | null = null;
    for (const id of objectIds) {
      if (!currentRange || id !== currentRange.ids[currentRange.ids.length - 1] + 1) {
        currentRange = { start: id, ids: [id] };
        contiguousRanges.push(currentRange);
      } else {
        currentRange.ids.push(id);
      }
    }

    for (const range of contiguousRanges) {
      xrefText += `${range.start} ${range.ids.length}\n`;
      for (const id of range.ids) {
        const offset = objectOffsets.get(id)!;
        const padOffset = String(offset).padStart(10, '0');
        xrefText += `${padOffset} 00000 n \n`;
      }
    }

    const rootRef = this.parser.trailer['Root'] as PDFRef;
    const rootStr = rootRef ? `${rootRef.num} ${rootRef.gen} R` : '1 0 R';
    const totalSize = maxObjNum + 1;

    let trailerText = 'trailer\n<<\n';
    trailerText += `  /Size ${totalSize}\n`;
    trailerText += `  /Root ${rootStr}\n`;
    if (originalStartXRef > 0) {
      trailerText += `  /Prev ${originalStartXRef}\n`;
    }
    trailerText += '>>\n';
    trailerText += 'startxref\n';
    trailerText += `${xrefOffset}\n`;
    trailerText += '%%EOF\n';

    updateText += xrefText + trailerText;

    const updateBytes = encoder.encode(updateText);
    const finalBuffer = new Uint8Array(originalBytes.length + updateBytes.length);
    finalBuffer.set(originalBytes, 0);
    finalBuffer.set(updateBytes, originalBytes.length);

    return finalBuffer;
  }

  private serializeAnnotation(objNum: number, annot: Annotation): string {
    const [x1, y1, x2, y2] = annot.rect;
    const [r, g, b] = this.hexToPdfRgb(annot.color);
    const rectStr = `[${x1.toFixed(2)} ${y1.toFixed(2)} ${x2.toFixed(2)} ${y2.toFixed(2)}]`;
    const colorStr = `[${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)}]`;
    const escapedAuthor = annot.author ? `(${this.escapePdfString(annot.author)})` : '(User)';
    const escapedContents = annot.contents ? `(${this.escapePdfString(annot.contents)})` : '()';

    let dict = '<<\n';
    dict += '  /Type /Annot\n';

    switch (annot.type) {
      case 'highlight': {
        dict += '  /Subtype /Highlight\n';
        dict += `  /Rect ${rectStr}\n`;
        dict += `  /C ${colorStr}\n`;
        dict += `  /T ${escapedAuthor}\n`;
        dict += `  /Contents ${escapedContents}\n`;
        dict += `  /QuadPoints [${x1.toFixed(2)} ${y2.toFixed(2)} ${x2.toFixed(2)} ${y2.toFixed(2)} ${x1.toFixed(2)} ${y1.toFixed(2)} ${x2.toFixed(2)} ${y1.toFixed(2)}]\n`;
        dict += '  /F 4\n';
        break;
      }
      case 'underline': {
        dict += '  /Subtype /Underline\n';
        dict += `  /Rect ${rectStr}\n`;
        dict += `  /C ${colorStr}\n`;
        dict += `  /T ${escapedAuthor}\n`;
        dict += `  /Contents ${escapedContents}\n`;
        dict += `  /QuadPoints [${x1.toFixed(2)} ${y2.toFixed(2)} ${x2.toFixed(2)} ${y2.toFixed(2)} ${x1.toFixed(2)} ${y1.toFixed(2)} ${x2.toFixed(2)} ${y1.toFixed(2)}]\n`;
        dict += '  /F 4\n';
        break;
      }
      case 'ink': {
        dict += '  /Subtype /Ink\n';
        dict += `  /Rect ${rectStr}\n`;
        dict += `  /C ${colorStr}\n`;
        dict += `  /T ${escapedAuthor}\n`;
        dict += `  /BS << /W ${(annot.strokeWidth || 2).toFixed(1)} >>\n`;
        let inkList = '[ ';
        for (const p of annot.paths) {
          inkList += '[ ';
          for (const pt of p) {
            inkList += `${pt.x.toFixed(2)} ${pt.y.toFixed(2)} `;
          }
          inkList += '] ';
        }
        inkList += ']';
        dict += `  /InkList ${inkList}\n`;
        dict += '  /F 4\n';
        break;
      }
      case 'note': {
        dict += '  /Subtype /Text\n';
        dict += `  /Rect ${rectStr}\n`;
        dict += `  /C ${colorStr}\n`;
        dict += `  /T ${escapedAuthor}\n`;
        dict += `  /Contents ${escapedContents}\n`;
        dict += '  /Name /Comment\n';
        dict += '  /Open false\n';
        dict += '  /F 4\n';
        break;
      }
      case 'rect': {
        dict += '  /Subtype /Square\n';
        dict += `  /Rect ${rectStr}\n`;
        dict += `  /C ${colorStr}\n`;
        dict += `  /T ${escapedAuthor}\n`;
        dict += `  /BS << /W ${(annot.strokeWidth || 2).toFixed(1)} >>\n`;
        if (annot.fillColor) {
          const [fr, fg, fb] = this.hexToPdfRgb(annot.fillColor);
          dict += `  /IC [${fr.toFixed(3)} ${fg.toFixed(3)} ${fb.toFixed(3)}]\n`;
        }
        dict += '  /F 4\n';
        break;
      }
    }

    dict += '>>';
    return dict;
  }

  private serializePageWithAnnots(page: PageInfo, newAnnotRefs: string[]): string {
    const rawPage = this.parser.resolvedObjects.get(page.objNum) as Record<string, any> || page.dict;
    let existingRefs: string[] = [];

    if (rawPage['Annots']) {
      const annots = rawPage['Annots'];
      if (Array.isArray(annots)) {
        for (const a of annots) {
          if (this.parser.isRef(a)) {
            existingRefs.push(`${a.num} ${a.gen} R`);
          }
        }
      }
    }

    const allAnnots = [...existingRefs, ...newAnnotRefs];

    let dict = '<<\n';
    dict += '  /Type /Page\n';

    for (const [k, v] of Object.entries(rawPage)) {
      if (k === 'Type' || k === 'Annots') continue;
      dict += `  /${k} ${this.serializePdfValue(v)}\n`;
    }

    dict += `  /Annots [ ${allAnnots.join(' ')} ]\n`;
    dict += '>>';
    return dict;
  }

  private serializePdfValue(val: any): string {
    if (val === null || val === undefined) return 'null';
    if (typeof val === 'number') return String(val);
    if (typeof val === 'boolean') return val ? 'true' : 'false';
    if (typeof val === 'string') return `(${this.escapePdfString(val)})`;
    if (this.parser.isRef(val)) return `${val.num} ${val.gen} R`;
    if (this.parser.isName(val)) return `/${val.name}`;
    if (Array.isArray(val)) {
      return `[ ${val.map((i) => this.serializePdfValue(i)).join(' ')} ]`;
    }
    if (typeof val === 'object') {
      let d = '<< ';
      for (const [k, v] of Object.entries(val)) {
        d += `/${k} ${this.serializePdfValue(v)} `;
      }
      d += '>>';
      return d;
    }
    return String(val);
  }

  private escapePdfString(str: string): string {
    return str
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n');
  }

  private hexToPdfRgb(hex: string): [number, number, number] {
    let clean = hex.replace('#', '');
    if (clean.length === 3) {
      clean = clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2];
    }
    const num = parseInt(clean, 16);
    if (isNaN(num)) return [1, 1, 0];
    const r = ((num >> 16) & 255) / 255;
    const g = ((num >> 8) & 255) / 255;
    const b = (num & 255) / 255;
    return [r, g, b];
  }
}
