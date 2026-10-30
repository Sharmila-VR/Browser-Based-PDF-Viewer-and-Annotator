export interface PDFRef {
  num: number;
  gen: number;
}

export interface PDFName {
  name: string;
}

export interface PDFStream {
  dict: Record<string, PDFObject>;
  data: Uint8Array;
  offset?: number;
}

export type PDFObject =
  | number
  | string
  | boolean
  | null
  | PDFRef
  | PDFName
  | PDFObject[]
  | { [key: string]: PDFObject }
  | PDFStream;

export interface XRefEntry {
  offset: number;
  gen: number;
  free: boolean;
  inStream?: boolean;
  streamObjNum?: number;
  streamIndex?: number;
}

export interface PageInfo {
  index: number;
  objNum: number;
  dict: Record<string, PDFObject>;
  mediaBox: [number, number, number, number];
  cropBox: [number, number, number, number];
  rotate: number;
  resources: Record<string, PDFObject>;
  contents: PDFObject;
}

export interface OutlineItem {
  title: string;
  dest?: PDFObject;
  pageIndex?: number;
  children?: OutlineItem[];
}

export interface TextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontName: string;
  fontSize: number;
  transform: [number, number, number, number, number, number];
}

export type AnnotationType = 'highlight' | 'underline' | 'ink' | 'note' | 'rect';

export interface BaseAnnotation {
  id: string;
  type: AnnotationType;
  pageIndex: number;
  color: string;
  rect: [number, number, number, number];
  author?: string;
  contents?: string;
  createdAt: number;
  modifiedAt: number;
}

export interface HighlightAnnotation extends BaseAnnotation {
  type: 'highlight';
  quadPoints?: number[];
}

export interface UnderlineAnnotation extends BaseAnnotation {
  type: 'underline';
  quadPoints?: number[];
}

export interface InkAnnotation extends BaseAnnotation {
  type: 'ink';
  paths: Array<Array<{ x: number; y: number }>>;
  strokeWidth: number;
}

export interface NoteAnnotation extends BaseAnnotation {
  type: 'note';
  contents: string;
}

export interface RectAnnotation extends BaseAnnotation {
  type: 'rect';
  fillColor?: string;
  strokeWidth: number;
}

export type Annotation =
  | HighlightAnnotation
  | UnderlineAnnotation
  | InkAnnotation
  | NoteAnnotation
  | RectAnnotation;

export interface SearchMatch {
  pageIndex: number;
  textIndex: number;
  matchIndex: number;
  str: string;
  rect: [number, number, number, number];
  context: string;
}
