import React from 'react';
import { PageInfo, SearchMatch, TextItem } from '../pdf/types';

interface TextLayerProps {
  page: PageInfo;
  scale: number;
  textItems: TextItem[];
  searchMatches: SearchMatch[];
  currentMatchIndex: number;
  onTextSelected?: (rect: [number, number, number, number], text: string) => void;
}

export const TextLayer: React.FC<TextLayerProps> = ({
  page,
  scale,
  textItems,
  searchMatches,
  currentMatchIndex,
  onTextSelected,
}) => {
  const cropBox = page.cropBox || page.mediaBox || [0, 0, 612, 792];
  const pageHeight = cropBox[3] - cropBox[1];

  const handleMouseUp = () => {
    if (!onTextSelected) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;

    const range = sel.getRangeAt(0);
    const text = sel.toString().trim();
    if (!text) return;

    const rects = range.getClientRects();
    if (rects.length === 0) return;

    const firstRect = rects[0];
    const container = document.getElementById(`page-container-${page.index}`);
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const relX1 = (firstRect.left - containerRect.left) / scale;
    const relY1 = (firstRect.top - containerRect.top) / scale;
    const relX2 = (firstRect.right - containerRect.left) / scale;
    const relY2 = (firstRect.bottom - containerRect.top) / scale;

    const pdfX1 = cropBox[0] + relX1;
    const pdfY2 = cropBox[3] - relY1;
    const pdfX2 = cropBox[0] + relX2;
    const pdfY1 = cropBox[3] - relY2;

    onTextSelected([pdfX1, pdfY1, pdfX2, pdfY2], text);
  };

  const pageMatches = searchMatches.filter((m) => m.pageIndex === page.index);

  return (
    <div
      className="text-layer"
      onMouseUp={handleMouseUp}
      aria-label={`Text content of page ${page.index + 1}`}
    >
      {textItems.map((item, idx) => {
        const left = (item.x - cropBox[0]) * scale;
        const top = (pageHeight - (item.y - cropBox[1])) * scale;
        const width = item.width * scale;
        const height = item.height * scale;
        const fontSize = item.fontSize * scale;

        const isMatched = pageMatches.some((m) => m.textIndex === idx);
        const isActive = isMatched && searchMatches[currentMatchIndex]?.pageIndex === page.index && searchMatches[currentMatchIndex]?.textIndex === idx;

        return (
          <span
            key={idx}
            className={`text-span ${isMatched ? 'search-match' : ''} ${isActive ? 'search-active' : ''}`}
            style={{
              left: `${left}px`,
              top: `${top - height}px`,
              width: `${Math.max(width, 2)}px`,
              height: `${height}px`,
              fontSize: `${fontSize}px`,
              fontFamily: 'Helvetica, Arial, sans-serif',
            }}
          >
            {item.str}
          </span>
        );
      })}
    </div>
  );
};
