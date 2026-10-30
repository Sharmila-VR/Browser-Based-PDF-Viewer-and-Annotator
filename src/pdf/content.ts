import { PDFLexer, TokenType } from './lexer';
import { PDFParser } from './parser';
import { PDFFont, PDFFontHandler } from './font';
import { PDFObject, PDFStream, TextItem } from './types';
import { decompressFlate } from './decompress';

export interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export function identityMatrix(): Matrix {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

export function multiplyMatrix(m1: Matrix, m2: Matrix): Matrix {
  return {
    a: m1.a * m2.a + m1.b * m2.c,
    b: m1.a * m2.b + m1.b * m2.d,
    c: m1.c * m2.a + m1.d * m2.c,
    d: m1.c * m2.b + m1.d * m2.d,
    e: m1.e * m2.a + m1.f * m2.c + m2.e,
    f: m1.e * m2.b + m1.f * m2.d + m2.f,
  };
}

class Path2DFallback {
  moveTo(_x: number, _y: number) {}
  lineTo(_x: number, _y: number) {}
  bezierCurveTo(_cp1x: number, _cp1y: number, _cp2x: number, _cp2y: number, _x: number, _y: number) {}
  rect(_x: number, _y: number, _w: number, _h: number) {}
  closePath() {}
}

const SafePath2D: typeof Path2D = typeof Path2D !== 'undefined' ? Path2D : (Path2DFallback as any);

export interface GraphicsState {
  ctm: Matrix;
  fillColor: string;
  strokeColor: string;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  miterLimit: number;
  dashArray: number[];
  dashPhase: number;
  font: PDFFont | null;
  fontSize: number;
  charSpacing: number;
  wordSpacing: number;
  horizontalScale: number;
  leading: number;
  renderMode: number;
  textRise: number;
}

export class ContentInterpreter {
  private parser: PDFParser;
  private fontHandler: PDFFontHandler;
  private resources: Record<string, PDFObject>;
  private stateStack: GraphicsState[] = [];
  public state: GraphicsState;
  public textMatrix: Matrix = identityMatrix();
  public textLineMatrix: Matrix = identityMatrix();
  public textItems: TextItem[] = [];

  constructor(parser: PDFParser, fontHandler: PDFFontHandler, resources: Record<string, PDFObject>) {
    this.parser = parser;
    this.fontHandler = fontHandler;
    this.resources = resources;
    this.state = this.createDefaultState();
  }

  private createDefaultState(): GraphicsState {
    return {
      ctm: identityMatrix(),
      fillColor: '#000000',
      strokeColor: '#000000',
      lineWidth: 1,
      lineCap: 'butt',
      lineJoin: 'miter',
      miterLimit: 10,
      dashArray: [],
      dashPhase: 0,
      font: null,
      fontSize: 12,
      charSpacing: 0,
      wordSpacing: 0,
      horizontalScale: 100,
      leading: 0,
      renderMode: 0,
      textRise: 0,
    };
  }

  private cloneState(s: GraphicsState): GraphicsState {
    return {
      ctm: { ...s.ctm },
      fillColor: s.fillColor,
      strokeColor: s.strokeColor,
      lineWidth: s.lineWidth,
      lineCap: s.lineCap,
      lineJoin: s.lineJoin,
      miterLimit: s.miterLimit,
      dashArray: [...s.dashArray],
      dashPhase: s.dashPhase,
      font: s.font,
      fontSize: s.fontSize,
      charSpacing: s.charSpacing,
      wordSpacing: s.wordSpacing,
      horizontalScale: s.horizontalScale,
      leading: s.leading,
      renderMode: s.renderMode,
      textRise: s.textRise,
    };
  }

  async execute(contentBytes: Uint8Array, ctx: CanvasRenderingContext2D | null): Promise<TextItem[]> {
    this.textItems = [];
    const lexer = new PDFLexer(contentBytes, 0);
    const args: any[] = [];
    let currentPath = new SafePath2D();

    while (lexer.pos < lexer.length) {
      lexer.skipWhitespaceAndComments();
      if (lexer.pos >= lexer.length) break;

      const token = lexer.nextToken();
      if (token.type === TokenType.EOF) break;

      if (token.type !== TokenType.Keyword || typeof token.value !== 'string' || this.isNumberOrString(token.value)) {
        if (token.type === TokenType.ArrayOpen) {
          const arr = await this.readArray(lexer);
          args.push(arr);
        } else if (token.type === TokenType.DictOpen) {
          const dict = await this.readDict(lexer);
          args.push(dict);
        } else {
          args.push(token.value);
        }
        continue;
      }

      const op = token.value;
      await this.processOperator(op, args, ctx, currentPath, (newP) => {
        currentPath = newP;
      });
      args.length = 0;
    }

    return this.textItems;
  }

  private isNumberOrString(val: any): boolean {
    return typeof val === 'number' || val === true || val === false || val === null;
  }

  private async readArray(lexer: PDFLexer): Promise<any[]> {
    const arr: any[] = [];
    while (lexer.pos < lexer.length) {
      lexer.skipWhitespaceAndComments();
      if (lexer.peekByte() === 0x5d) {
        lexer.readByte();
        break;
      }
      const tok = lexer.nextToken();
      if (tok.type === TokenType.EOF) break;
      arr.push(tok.value);
    }
    return arr;
  }

  private async readDict(lexer: PDFLexer): Promise<Record<string, any>> {
    const dict: Record<string, any> = {};
    while (lexer.pos < lexer.length) {
      lexer.skipWhitespaceAndComments();
      if (lexer.peekByte() === 0x3e && lexer.buffer[lexer.pos + 1] === 0x3e) {
        lexer.seek(lexer.pos + 2);
        break;
      }
      const k = lexer.nextToken();
      if (k.type === TokenType.EOF || (k.type === TokenType.Keyword && k.value === '>>')) break;
      const v = lexer.nextToken();
      const keyName = typeof k.value === 'object' && k.value !== null && 'name' in k.value ? k.value.name : String(k.value);
      dict[keyName] = v.value;
    }
    return dict;
  }

  private async processOperator(
    op: string,
    args: any[],
    ctx: CanvasRenderingContext2D | null,
    path: any,
    setPath: (p: any) => void
  ): Promise<void> {
    switch (op) {
      case 'q': {
        this.stateStack.push(this.cloneState(this.state));
        if (ctx) ctx.save();
        break;
      }
      case 'Q': {
        if (this.stateStack.length > 0) {
          this.state = this.stateStack.pop()!;
        }
        if (ctx) ctx.restore();
        break;
      }
      case 'cm': {
        if (args.length >= 6) {
          const m: Matrix = { a: args[0], b: args[1], c: args[2], d: args[3], e: args[4], f: args[5] };
          this.state.ctm = multiplyMatrix(m, this.state.ctm);
          if (ctx) {
            ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
          }
        }
        break;
      }
      case 'w': {
        if (args.length >= 1) {
          this.state.lineWidth = args[0];
          if (ctx) ctx.lineWidth = args[0];
        }
        break;
      }
      case 'J': {
        if (args.length >= 1) {
          const capMap: CanvasLineCap[] = ['butt', 'round', 'square'];
          this.state.lineCap = capMap[args[0]] || 'butt';
          if (ctx) ctx.lineCap = this.state.lineCap;
        }
        break;
      }
      case 'j': {
        if (args.length >= 1) {
          const joinMap: CanvasLineJoin[] = ['miter', 'round', 'bevel'];
          this.state.lineJoin = joinMap[args[0]] || 'miter';
          if (ctx) ctx.lineJoin = this.state.lineJoin;
        }
        break;
      }
      case 'M': {
        if (args.length >= 1) {
          this.state.miterLimit = args[0];
          if (ctx) ctx.miterLimit = args[0];
        }
        break;
      }
      case 'd': {
        if (args.length >= 2) {
          this.state.dashArray = Array.isArray(args[0]) ? args[0] : [];
          this.state.dashPhase = args[1] || 0;
          if (ctx) {
            ctx.setLineDash(this.state.dashArray);
            ctx.lineDashOffset = this.state.dashPhase;
          }
        }
        break;
      }
      case 'rg': {
        if (args.length >= 3) {
          const r = Math.round(args[0] * 255);
          const g = Math.round(args[1] * 255);
          const b = Math.round(args[2] * 255);
          this.state.fillColor = `rgb(${r},${g},${b})`;
          if (ctx) ctx.fillStyle = this.state.fillColor;
        }
        break;
      }
      case 'RG': {
        if (args.length >= 3) {
          const r = Math.round(args[0] * 255);
          const g = Math.round(args[1] * 255);
          const b = Math.round(args[2] * 255);
          this.state.strokeColor = `rgb(${r},${g},${b})`;
          if (ctx) ctx.strokeStyle = this.state.strokeColor;
        }
        break;
      }
      case 'g': {
        if (args.length >= 1) {
          const v = Math.round(args[0] * 255);
          this.state.fillColor = `rgb(${v},${v},${v})`;
          if (ctx) ctx.fillStyle = this.state.fillColor;
        }
        break;
      }
      case 'G': {
        if (args.length >= 1) {
          const v = Math.round(args[0] * 255);
          this.state.strokeColor = `rgb(${v},${v},${v})`;
          if (ctx) ctx.strokeStyle = this.state.strokeColor;
        }
        break;
      }
      case 'k': {
        if (args.length >= 4) {
          const c = args[0], m = args[1], y = args[2], k = args[3];
          const r = Math.round(255 * (1 - c) * (1 - k));
          const g = Math.round(255 * (1 - m) * (1 - k));
          const b = Math.round(255 * (1 - y) * (1 - k));
          this.state.fillColor = `rgb(${r},${g},${b})`;
          if (ctx) ctx.fillStyle = this.state.fillColor;
        }
        break;
      }
      case 'K': {
        if (args.length >= 4) {
          const c = args[0], m = args[1], y = args[2], k = args[3];
          const r = Math.round(255 * (1 - c) * (1 - k));
          const g = Math.round(255 * (1 - m) * (1 - k));
          const b = Math.round(255 * (1 - y) * (1 - k));
          this.state.strokeColor = `rgb(${r},${g},${b})`;
          if (ctx) ctx.strokeStyle = this.state.strokeColor;
        }
        break;
      }

      case 'm': {
        if (args.length >= 2) {
          path.moveTo(args[0], args[1]);
        }
        break;
      }
      case 'l': {
        if (args.length >= 2) {
          path.lineTo(args[0], args[1]);
        }
        break;
      }
      case 'c': {
        if (args.length >= 6) {
          path.bezierCurveTo(args[0], args[1], args[2], args[3], args[4], args[5]);
        }
        break;
      }
      case 'v': {
        if (args.length >= 4) {
          path.bezierCurveTo(args[0], args[1], args[0], args[1], args[2], args[3]);
        }
        break;
      }
      case 'y': {
        if (args.length >= 4) {
          path.bezierCurveTo(args[0], args[1], args[2], args[3], args[2], args[3]);
        }
        break;
      }
      case 're': {
        if (args.length >= 4) {
          path.rect(args[0], args[1], args[2], args[3]);
        }
        break;
      }
      case 'h': {
        path.closePath();
        break;
      }

      case 'S': {
        if (ctx) {
          ctx.strokeStyle = this.state.strokeColor;
          ctx.stroke(path);
        }
        setPath(new SafePath2D());
        break;
      }
      case 's': {
        path.closePath();
        if (ctx) {
          ctx.strokeStyle = this.state.strokeColor;
          ctx.stroke(path);
        }
        setPath(new SafePath2D());
        break;
      }
      case 'f':
      case 'F': {
        if (ctx) {
          ctx.fillStyle = this.state.fillColor;
          ctx.fill(path, 'nonzero');
        }
        setPath(new SafePath2D());
        break;
      }
      case 'f*': {
        if (ctx) {
          ctx.fillStyle = this.state.fillColor;
          ctx.fill(path, 'evenodd');
        }
        setPath(new SafePath2D());
        break;
      }
      case 'B': {
        if (ctx) {
          ctx.fillStyle = this.state.fillColor;
          ctx.strokeStyle = this.state.strokeColor;
          ctx.fill(path, 'nonzero');
          ctx.stroke(path);
        }
        setPath(new SafePath2D());
        break;
      }
      case 'B*': {
        if (ctx) {
          ctx.fillStyle = this.state.fillColor;
          ctx.strokeStyle = this.state.strokeColor;
          ctx.fill(path, 'evenodd');
          ctx.stroke(path);
        }
        setPath(new SafePath2D());
        break;
      }
      case 'b': {
        path.closePath();
        if (ctx) {
          ctx.fillStyle = this.state.fillColor;
          ctx.strokeStyle = this.state.strokeColor;
          ctx.fill(path, 'nonzero');
          ctx.stroke(path);
        }
        setPath(new SafePath2D());
        break;
      }
      case 'b*': {
        path.closePath();
        if (ctx) {
          ctx.fillStyle = this.state.fillColor;
          ctx.strokeStyle = this.state.strokeColor;
          ctx.fill(path, 'evenodd');
          ctx.stroke(path);
        }
        setPath(new SafePath2D());
        break;
      }
      case 'n': {
        setPath(new SafePath2D());
        break;
      }
      case 'W': {
        if (ctx) ctx.clip(path, 'nonzero');
        break;
      }
      case 'W*': {
        if (ctx) ctx.clip(path, 'evenodd');
        break;
      }

      case 'BT': {
        this.textMatrix = identityMatrix();
        this.textLineMatrix = identityMatrix();
        break;
      }
      case 'ET': {
        break;
      }
      case 'Tf': {
        if (args.length >= 2) {
          const fontName = typeof args[0] === 'object' && args[0] !== null && 'name' in args[0] ? args[0].name : String(args[0]);
          this.state.fontSize = args[1];
          await this.selectFont(fontName);
        }
        break;
      }
      case 'Tc': {
        if (args.length >= 1) this.state.charSpacing = args[0];
        break;
      }
      case 'Tw': {
        if (args.length >= 1) this.state.wordSpacing = args[0];
        break;
      }
      case 'Tz': {
        if (args.length >= 1) this.state.horizontalScale = args[0];
        break;
      }
      case 'TL': {
        if (args.length >= 1) this.state.leading = args[0];
        break;
      }
      case 'Tr': {
        if (args.length >= 1) this.state.renderMode = args[0];
        break;
      }
      case 'Ts': {
        if (args.length >= 1) this.state.textRise = args[0];
        break;
      }
      case 'Td': {
        if (args.length >= 2) {
          const tx = args[0], ty = args[1];
          const m: Matrix = { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty };
          this.textLineMatrix = multiplyMatrix(m, this.textLineMatrix);
          this.textMatrix = { ...this.textLineMatrix };
        }
        break;
      }
      case 'TD': {
        if (args.length >= 2) {
          const tx = args[0], ty = args[1];
          this.state.leading = -ty;
          const m: Matrix = { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty };
          this.textLineMatrix = multiplyMatrix(m, this.textLineMatrix);
          this.textMatrix = { ...this.textLineMatrix };
        }
        break;
      }
      case 'Tm': {
        if (args.length >= 6) {
          this.textMatrix = { a: args[0], b: args[1], c: args[2], d: args[3], e: args[4], f: args[5] };
          this.textLineMatrix = { ...this.textMatrix };
        }
        break;
      }
      case 'T*': {
        const m: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: -this.state.leading };
        this.textLineMatrix = multiplyMatrix(m, this.textLineMatrix);
        this.textMatrix = { ...this.textLineMatrix };
        break;
      }
      case 'Tj': {
        if (args.length >= 1) {
          this.renderString(args[0], ctx);
        }
        break;
      }
      case "'": {
        const m: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: -this.state.leading };
        this.textLineMatrix = multiplyMatrix(m, this.textLineMatrix);
        this.textMatrix = { ...this.textLineMatrix };
        if (args.length >= 1) {
          this.renderString(args[0], ctx);
        }
        break;
      }
      case '"': {
        if (args.length >= 3) {
          this.state.wordSpacing = args[0];
          this.state.charSpacing = args[1];
          const m: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: -this.state.leading };
          this.textLineMatrix = multiplyMatrix(m, this.textLineMatrix);
          this.textMatrix = { ...this.textLineMatrix };
          this.renderString(args[2], ctx);
        }
        break;
      }
      case 'TJ': {
        if (args.length >= 1 && Array.isArray(args[0])) {
          this.renderTJArray(args[0], ctx);
        }
        break;
      }

      case 'Do': {
        if (args.length >= 1) {
          const xobjName = typeof args[0] === 'object' && args[0] !== null && 'name' in args[0] ? args[0].name : String(args[0]);
          await this.renderXObject(xobjName, ctx);
        }
        break;
      }
    }
  }

  private async selectFont(name: string): Promise<void> {
    const fontRes = (await this.parser.resolve(this.resources['Font'])) as Record<string, PDFObject>;
    if (fontRes && fontRes[name]) {
      this.state.font = await this.fontHandler.loadFont(fontRes[name]);
    }
  }

  private renderString(str: string, ctx: CanvasRenderingContext2D | null): void {
    if (!str || typeof str !== 'string') return;
    const font = this.state.font;
    const fontSize = this.state.fontSize;
    const scale = (this.state.horizontalScale / 100);

    let mapped = '';
    let totalAdvance = 0;

    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      const ch = font ? this.fontHandler.mapCharCode(code, font) : String.fromCharCode(code);
      mapped += ch;

      const glyphWidth = font ? this.fontHandler.getGlyphWidth(code, font) : 500;
      const charWidth = (glyphWidth / 1000) * fontSize * scale;
      totalAdvance += charWidth + this.state.charSpacing;
      if (code === 32) {
        totalAdvance += this.state.wordSpacing;
      }
    }

    const t = multiplyMatrix(this.textMatrix, this.state.ctm);
    this.textItems.push({
      str: mapped,
      x: t.e,
      y: t.f,
      width: totalAdvance,
      height: fontSize,
      fontName: font ? font.baseFont : 'Helvetica',
      fontSize,
      transform: [t.a, t.b, t.c, t.d, t.e, t.f],
    });

    if (ctx && font) {
      ctx.save();
      ctx.transform(this.textMatrix.a, this.textMatrix.b, this.textMatrix.c, this.textMatrix.d, this.textMatrix.e, this.textMatrix.f);
      ctx.scale(scale, -1);
      ctx.font = `${font.fontStyle} ${font.fontWeight} ${fontSize}px ${font.fontFamily}`;
      ctx.fillStyle = this.state.fillColor;
      ctx.fillText(mapped, 0, 0);
      ctx.restore();
    }

    const advanceMatrix: Matrix = { a: 1, b: 0, c: 0, d: 1, e: totalAdvance, f: 0 };
    this.textMatrix = multiplyMatrix(advanceMatrix, this.textMatrix);
  }

  private renderTJArray(items: any[], ctx: CanvasRenderingContext2D | null): void {
    const fontSize = this.state.fontSize;
    const scale = (this.state.horizontalScale / 100);

    for (const item of items) {
      if (typeof item === 'string') {
        this.renderString(item, ctx);
      } else if (typeof item === 'number') {
        const offset = -item / 1000 * fontSize * scale;
        const advanceMatrix: Matrix = { a: 1, b: 0, c: 0, d: 1, e: offset, f: 0 };
        this.textMatrix = multiplyMatrix(advanceMatrix, this.textMatrix);
      }
    }
  }

  private async renderXObject(name: string, ctx: CanvasRenderingContext2D | null): Promise<void> {
    const xobjRes = (await this.parser.resolve(this.resources['XObject'])) as Record<string, PDFObject>;
    if (!xobjRes || !xobjRes[name]) return;

    const xobj = (await this.parser.resolve(xobjRes[name])) as PDFStream;
    if (!xobj || !xobj.dict) return;

    const subtype = this.parser.getNameValue(xobj.dict['Subtype']);

    if (subtype === 'Form') {
      const subResources = (await this.parser.resolve(xobj.dict['Resources'] || this.resources)) as Record<string, PDFObject>;
      const formInterpreter = new ContentInterpreter(this.parser, this.fontHandler, subResources);
      if (ctx) ctx.save();
      if (xobj.dict['Matrix']) {
        const m = xobj.dict['Matrix'] as number[];
        if (m.length >= 6 && ctx) {
          ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
        }
      }
      const decompressed = await decompressFlate(xobj.data, xobj.dict['DecodeParms'] as any);
      const subTexts = await formInterpreter.execute(decompressed, ctx);
      this.textItems.push(...subTexts);
      if (ctx) ctx.restore();
      return;
    }

    if (subtype === 'Image' && ctx) {
      const width = xobj.dict['Width'] as number;
      const height = xobj.dict['Height'] as number;
      const filter = this.parser.getNameValue(xobj.dict['Filter']);

      if (filter === 'DCTDecode') {
        const blob = new Blob([xobj.data as any], { type: 'image/jpeg' });
        const img = await createImageBitmap(blob);
        ctx.save();
        ctx.scale(1, -1);
        ctx.translate(0, -1);
        ctx.drawImage(img, 0, 0, 1, 1);
        ctx.restore();
      } else {
        try {
          const raw = await decompressFlate(xobj.data, xobj.dict['DecodeParms'] as any);
          const colorSpace = this.parser.getNameValue(xobj.dict['ColorSpace']) || 'DeviceRGB';
          const isRGB = colorSpace === 'DeviceRGB' || raw.length === width * height * 3;

          const imgData = ctx.createImageData(width, height);
          let srcIdx = 0;
          let dstIdx = 0;

          for (let i = 0; i < width * height; i++) {
            if (isRGB) {
              imgData.data[dstIdx++] = raw[srcIdx++];
              imgData.data[dstIdx++] = raw[srcIdx++];
              imgData.data[dstIdx++] = raw[srcIdx++];
              imgData.data[dstIdx++] = 255;
            } else {
              const g = raw[srcIdx++];
              imgData.data[dstIdx++] = g;
              imgData.data[dstIdx++] = g;
              imgData.data[dstIdx++] = g;
              imgData.data[dstIdx++] = 255;
            }
          }

          const offscreen = typeof OffscreenCanvas !== 'undefined'
            ? new OffscreenCanvas(width, height)
            : (document.createElement('canvas') as any);
          offscreen.width = width;
          offscreen.height = height;
          const offCtx = offscreen.getContext('2d');
          if (offCtx) {
            offCtx.putImageData(imgData, 0, 0);
            ctx.save();
            ctx.scale(1, -1);
            ctx.translate(0, -1);
            ctx.drawImage(offscreen, 0, 0, 1, 1);
            ctx.restore();
          }
        } catch {
          // Skip unsupported image format gracefully
        }
      }
    }
  }
}
