import { PDFParser } from './parser';
import { PDFObject, PDFStream } from './types';
import { decompressFlate } from './decompress';

export interface PDFFont {
  baseFont: string;
  subtype: string;
  encoding?: string | Record<string, string>;
  toUnicode?: Map<number, string>;
  widths?: Map<number, number>;
  defaultWidth: number;
  firstChar: number;
  lastChar: number;
  isEmbedded: boolean;
  fontFamily: string;
  fontWeight: string;
  fontStyle: string;
}

const STANDARD_FONTS: Record<string, { family: string; weight: string; style: string }> = {
  'Helvetica': { family: 'Helvetica, Arial, sans-serif', weight: 'normal', style: 'normal' },
  'Helvetica-Bold': { family: 'Helvetica, Arial, sans-serif', weight: 'bold', style: 'normal' },
  'Helvetica-Oblique': { family: 'Helvetica, Arial, sans-serif', weight: 'normal', style: 'italic' },
  'Helvetica-BoldOblique': { family: 'Helvetica, Arial, sans-serif', weight: 'bold', style: 'italic' },
  'Times-Roman': { family: 'Times New Roman, Times, serif', weight: 'normal', style: 'normal' },
  'Times-Bold': { family: 'Times New Roman, Times, serif', weight: 'bold', style: 'normal' },
  'Times-Italic': { family: 'Times New Roman, Times, serif', weight: 'normal', style: 'italic' },
  'Times-BoldItalic': { family: 'Times New Roman, Times, serif', weight: 'bold', style: 'italic' },
  'Courier': { family: 'Courier New, Courier, monospace', weight: 'normal', style: 'normal' },
  'Courier-Bold': { family: 'Courier New, Courier, monospace', weight: 'bold', style: 'normal' },
  'Courier-Oblique': { family: 'Courier New, Courier, monospace', weight: 'normal', style: 'italic' },
  'Courier-BoldOblique': { family: 'Courier New, Courier, monospace', weight: 'bold', style: 'italic' },
  'Symbol': { family: 'Symbol, sans-serif', weight: 'normal', style: 'normal' },
  'ZapfDingbats': { family: 'ZapfDingbats, sans-serif', weight: 'normal', style: 'normal' },
};

export class PDFFontHandler {
  private parser: PDFParser;
  private fontCache: Map<number, PDFFont> = new Map();

  constructor(parser: PDFParser) {
    this.parser = parser;
  }

  async loadFont(fontRefOrDict: PDFObject): Promise<PDFFont> {
    if (this.parser.isRef(fontRefOrDict)) {
      if (this.fontCache.has(fontRefOrDict.num)) {
        return this.fontCache.get(fontRefOrDict.num)!;
      }
    }

    const dict = (await this.parser.resolve(fontRefOrDict)) as Record<string, PDFObject>;
    if (!dict) {
      return this.createFallbackFont('Helvetica');
    }

    const baseFont = this.parser.getNameValue(dict['BaseFont']) || 'Helvetica';
    const subtype = this.parser.getNameValue(dict['Subtype']) || 'Type1';

    let toUnicodeMap: Map<number, string> | undefined;
    if (dict['ToUnicode']) {
      try {
        const stream = (await this.parser.resolve(dict['ToUnicode'])) as PDFStream;
        if (stream && stream.data) {
          const raw = await decompressFlate(stream.data, stream.dict?.['DecodeParms'] as any);
          toUnicodeMap = this.parseToUnicodeCMap(raw);
        }
      } catch {
        // Continue without ToUnicode
      }
    }

    const firstChar = typeof dict['FirstChar'] === 'number' ? dict['FirstChar'] : 0;
    const lastChar = typeof dict['LastChar'] === 'number' ? dict['LastChar'] : 255;
    const widthsMap = new Map<number, number>();

    if (Array.isArray(dict['Widths'])) {
      const arr = dict['Widths'] as number[];
      for (let i = 0; i < arr.length; i++) {
        widthsMap.set(firstChar + i, arr[i]);
      }
    }

    let isEmbedded = false;
    let registeredFamily = '';

    if (dict['FontDescriptor']) {
      try {
        const desc = (await this.parser.resolve(dict['FontDescriptor'])) as Record<string, PDFObject>;
        if (desc && (desc['FontFile2'] || desc['FontFile'] || desc['FontFile3'])) {
          const fileRef = desc['FontFile2'] || desc['FontFile'] || desc['FontFile3'];
          const fontStream = (await this.parser.resolve(fileRef)) as PDFStream;
          if (fontStream && fontStream.data) {
            const fontBytes = await decompressFlate(fontStream.data, fontStream.dict?.['DecodeParms'] as any);
            registeredFamily = await this.registerFontFace(baseFont, fontBytes);
            if (registeredFamily) {
              isEmbedded = true;
            }
          }
        }
      } catch {
        // Fall back gracefully
      }
    }

    const std = STANDARD_FONTS[baseFont] || {
      family: registeredFamily || this.detectGenericFamily(baseFont),
      weight: baseFont.toLowerCase().includes('bold') ? 'bold' : 'normal',
      style: baseFont.toLowerCase().includes('italic') || baseFont.toLowerCase().includes('oblique') ? 'italic' : 'normal',
    };

    const font: PDFFont = {
      baseFont,
      subtype,
      toUnicode: toUnicodeMap,
      widths: widthsMap,
      defaultWidth: baseFont.toLowerCase().includes('courier') ? 600 : 500,
      firstChar,
      lastChar,
      isEmbedded,
      fontFamily: registeredFamily || std.family,
      fontWeight: std.weight,
      fontStyle: std.style,
    };

    if (this.parser.isRef(fontRefOrDict)) {
      this.fontCache.set(fontRefOrDict.num, font);
    }

    return font;
  }

  private detectGenericFamily(baseFont: string): string {
    const lower = baseFont.toLowerCase();
    if (lower.includes('sans') || lower.includes('arial') || lower.includes('helvetica')) {
      return 'Helvetica, Arial, sans-serif';
    }
    if (lower.includes('serif') || lower.includes('times') || lower.includes('roman') || lower.includes('georgia')) {
      return 'Times New Roman, Times, serif';
    }
    if (lower.includes('mono') || lower.includes('courier') || lower.includes('code')) {
      return 'Courier New, Courier, monospace';
    }
    return 'sans-serif';
  }

  private createFallbackFont(name: string): PDFFont {
    const std = STANDARD_FONTS[name] || STANDARD_FONTS['Helvetica'];
    return {
      baseFont: name,
      subtype: 'Type1',
      defaultWidth: 500,
      firstChar: 0,
      lastChar: 255,
      isEmbedded: false,
      fontFamily: std.family,
      fontWeight: std.weight,
      fontStyle: std.style,
    };
  }

  private parseToUnicodeCMap(data: Uint8Array): Map<number, string> {
    const map = new Map<number, string>();
    const text = new TextDecoder('latin1').decode(data);

    const bfcharMatch = text.match(/beginbfchar([\s\S]*?)endbfchar/g);
    if (bfcharMatch) {
      for (const section of bfcharMatch) {
        const lines = section.replace(/beginbfchar|endbfchar/g, '').trim().split(/\r?\n/);
        for (const line of lines) {
          const tokens = line.trim().match(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/);
          if (tokens) {
            const code = parseInt(tokens[1], 16);
            const str = this.hexToUnicode(tokens[2]);
            map.set(code, str);
          }
        }
      }
    }

    const bfrangeMatch = text.match(/beginbfrange([\s\S]*?)endbfrange/g);
    if (bfrangeMatch) {
      for (const section of bfrangeMatch) {
        const lines = section.replace(/beginbfrange|endbfrange/g, '').trim().split(/\r?\n/);
        for (const line of lines) {
          const rangeMatch = line.trim().match(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/);
          if (rangeMatch) {
            const start = parseInt(rangeMatch[1], 16);
            const end = parseInt(rangeMatch[2], 16);
            let target = parseInt(rangeMatch[3], 16);
            for (let c = start; c <= end; c++) {
              map.set(c, String.fromCharCode(target++));
            }
          }
        }
      }
    }

    return map;
  }

  private hexToUnicode(hex: string): string {
    let str = '';
    for (let i = 0; i < hex.length; i += 4) {
      const chunk = hex.substr(i, 4);
      str += String.fromCharCode(parseInt(chunk, 16));
    }
    return str;
  }

  private async registerFontFace(fontName: string, fontBytes: Uint8Array): Promise<string> {
    if (typeof FontFace === 'undefined' || typeof document === 'undefined') {
      return '';
    }
    try {
      const cleanName = 'PDF_Embedded_' + fontName.replace(/[^a-zA-Z0-9]/g, '_');
      const arrayBuffer = fontBytes.buffer.slice(fontBytes.byteOffset, fontBytes.byteOffset + fontBytes.byteLength) as ArrayBuffer;
      const fontFace = new FontFace(cleanName, arrayBuffer);
      await fontFace.load();
      document.fonts.add(fontFace);
      return cleanName;
    } catch {
      return '';
    }
  }

  mapCharCode(code: number, font: PDFFont): string {
    if (font.toUnicode && font.toUnicode.has(code)) {
      return font.toUnicode.get(code)!;
    }
    if (code >= 32 && code <= 126) {
      return String.fromCharCode(code);
    }
    if (code === 0xa0) return ' ';
    return String.fromCharCode(code);
  }

  getGlyphWidth(code: number, font: PDFFont): number {
    if (font.widths && font.widths.has(code)) {
      return font.widths.get(code)!;
    }
    if (code === 32) return 250;
    return font.defaultWidth;
  }
}
