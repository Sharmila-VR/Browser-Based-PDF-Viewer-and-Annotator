import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Annotation, AnnotationType, PageInfo, SearchMatch } from '../pdf/types';
import { PDFDocument } from '../pdf/document';
import { WorkerRenderClient } from '../pdf/workerClient';
import { PageItem } from './PageItem';

interface ViewportProps {
  doc: PDFDocument;
  workerClient: WorkerRenderClient;
  scale: number;
  rotation: number;
  activeTool: AnnotationType | 'select';
  activeColor: string;
  strokeWidth: number;
  selectedAnnotId: string | null;
  searchMatches: SearchMatch[];
  currentMatchIndex: number;
  onPageChange: (pageIndex: number) => void;
  onSelectAnnotation: (id: string | null) => void;
  onAddAnnotation: (annot: Annotation) => void;
  onUpdateAnnotation: (annot: Annotation) => void;
  onOpenNote: (annot: Annotation) => void;
  onTextSelected: (rect: [number, number, number, number], text: string) => void;
  onWheelZoom: (delta: number) => void;
}

export const Viewport: React.FC<ViewportProps> = ({
  doc,
  workerClient,
  scale,
  rotation,
  activeTool,
  activeColor,
  strokeWidth,
  selectedAnnotId,
  searchMatches,
  currentMatchIndex,
  onPageChange,
  onSelectAnnotation,
  onAddAnnotation,
  onUpdateAnnotation,
  onOpenNote,
  onTextSelected,
  onWheelZoom,
}) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [visiblePages, setVisiblePages] = useState<Set<number>>(new Set([0]));

  const calculateVisiblePages = useCallback(() => {
    if (!scrollRef.current) return;
    const container = scrollRef.current;
    const containerTop = container.scrollTop;
    const containerBottom = containerTop + container.clientHeight;

    const visible = new Set<number>();
    let foundActive = false;

    for (let i = 0; i < doc.pages.length; i++) {
      const pageEl = document.getElementById(`page-container-${i}`);
      if (!pageEl) continue;

      const offsetTop = pageEl.offsetTop;
      const offsetBottom = offsetTop + pageEl.clientHeight;

      const isPartiallyVisible = offsetBottom >= containerTop - 300 && offsetTop <= containerBottom + 300;

      if (isPartiallyVisible) {
        visible.add(i);
        if (!foundActive && offsetBottom >= containerTop + 100) {
          onPageChange(i);
          foundActive = true;
        }
      }
    }

    if (visible.size === 0 && doc.pages.length > 0) {
      visible.add(0);
    }

    setVisiblePages(visible);
  }, [doc.pages.length, onPageChange]);

  useEffect(() => {
    calculateVisiblePages();
  }, [scale, rotation, calculateVisiblePages]);

  const handleScroll = () => {
    calculateVisiblePages();
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      onWheelZoom(e.deltaY > 0 ? -0.1 : 0.1);
    }
  };

  return (
    <main
      ref={scrollRef}
      className="viewport-scroll-container"
      onScroll={handleScroll}
      onWheel={handleWheel}
      tabIndex={0}
      role="main"
      aria-label="PDF Document Pages Viewport"
    >
      <div className="pages-column">
        {doc.pages.map((page) => {
          const isVisible = visiblePages.has(page.index);
          const pageAnnots = doc.annotations.get(page.index) || [];

          return (
            <PageItem
              key={page.index}
              doc={doc}
              workerClient={workerClient}
              page={page}
              scale={scale}
              rotation={rotation}
              isVisible={isVisible}
              annotations={pageAnnots}
              activeTool={activeTool}
              activeColor={activeColor}
              strokeWidth={strokeWidth}
              selectedAnnotId={selectedAnnotId}
              searchMatches={searchMatches}
              currentMatchIndex={currentMatchIndex}
              onSelectAnnotation={onSelectAnnotation}
              onAddAnnotation={onAddAnnotation}
              onUpdateAnnotation={onUpdateAnnotation}
              onOpenNote={onOpenNote}
              onTextSelected={onTextSelected}
            />
          );
        })}
      </div>
    </main>
  );
};
