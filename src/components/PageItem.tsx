import React, { useEffect, useRef, useState } from 'react';
import { Annotation, AnnotationType, PageInfo, SearchMatch, TextItem } from '../pdf/types';
import { PDFDocument } from '../pdf/document';
import { WorkerRenderClient } from '../pdf/workerClient';
import { TextLayer } from './TextLayer';
import { AnnotationLayer } from './AnnotationLayer';

interface PageItemProps {
  doc: PDFDocument;
  workerClient: WorkerRenderClient;
  page: PageInfo;
  scale: number;
  rotation: number;
  isVisible: boolean;
  annotations: Annotation[];
  activeTool: AnnotationType | 'select';
  activeColor: string;
  strokeWidth: number;
  selectedAnnotId: string | null;
  searchMatches: SearchMatch[];
  currentMatchIndex: number;
  onSelectAnnotation: (id: string | null) => void;
  onAddAnnotation: (annot: Annotation) => void;
  onUpdateAnnotation: (annot: Annotation) => void;
  onOpenNote: (annot: Annotation) => void;
  onTextSelected: (rect: [number, number, number, number], text: string) => void;
}

export const PageItem: React.FC<PageItemProps> = ({
  doc,
  workerClient,
  page,
  scale,
  rotation,
  isVisible,
  annotations,
  activeTool,
  activeColor,
  strokeWidth,
  selectedAnnotId,
  searchMatches,
  currentMatchIndex,
  onSelectAnnotation,
  onAddAnnotation,
  onUpdateAnnotation,
  onOpenNote,
  onTextSelected,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [textItems, setTextItems] = useState<TextItem[]>([]);
  const [isRendered, setIsRendered] = useState(false);

  const effectiveRotation = (page.rotate + rotation) % 360;
  const cropBox = page.cropBox || page.mediaBox || [0, 0, 612, 792];
  const isRotated = effectiveRotation === 90 || effectiveRotation === 270;
  const pageWidth = isRotated ? (cropBox[3] - cropBox[1]) : (cropBox[2] - cropBox[0]);
  const pageHeight = isRotated ? (cropBox[2] - cropBox[0]) : (cropBox[3] - cropBox[1]);

  const cssWidth = Math.round(pageWidth * scale);
  const cssHeight = Math.round(pageHeight * scale);

  useEffect(() => {
    if (!isVisible) {
      if (isRendered && canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
          canvasRef.current.width = 1;
          canvasRef.current.height = 1;
        }
        setIsRendered(false);
      }
      return;
    }

    let isCancelled = false;

    const render = async () => {
      if (!canvasRef.current) return;
      try {
        const items = await workerClient.renderPage(doc, page.index, scale, canvasRef.current);
        if (!isCancelled) {
          setTextItems(items);
          setIsRendered(true);
        }
      } catch {
        // Render error handled gracefully
      }
    };

    render();

    return () => {
      isCancelled = true;
    };
  }, [isVisible, scale, effectiveRotation, page.index, doc]);

  return (
    <div
      id={`page-container-${page.index}`}
      className={`page-container ${isVisible ? 'page-visible' : 'page-hidden'}`}
      style={{
        width: `${cssWidth}px`,
        height: `${cssHeight}px`,
      }}
      data-page-index={page.index}
      role="region"
      aria-label={`Page ${page.index + 1}`}
    >
      <div className="page-shadow">
        {!isRendered && (
          <div className="page-placeholder" style={{ width: `${cssWidth}px`, height: `${cssHeight}px` }}>
            <div className="placeholder-content">
              <span className="placeholder-number">Page {page.index + 1}</span>
            </div>
          </div>
        )}

        <canvas
          ref={canvasRef}
          className="page-canvas"
          style={{
            display: isRendered ? 'block' : 'none',
            width: `${cssWidth}px`,
            height: `${cssHeight}px`,
          }}
        />

        {isRendered && (
          <TextLayer
            page={page}
            scale={scale}
            textItems={textItems}
            searchMatches={searchMatches}
            currentMatchIndex={currentMatchIndex}
            onTextSelected={onTextSelected}
          />
        )}

        {isRendered && (
          <AnnotationLayer
            page={page}
            scale={scale}
            annotations={annotations}
            activeTool={activeTool}
            activeColor={activeColor}
            strokeWidth={strokeWidth}
            selectedId={selectedAnnotId}
            onSelectAnnotation={onSelectAnnotation}
            onAddAnnotation={onAddAnnotation}
            onUpdateAnnotation={onUpdateAnnotation}
            onOpenNote={onOpenNote}
          />
        )}
      </div>
    </div>
  );
};
