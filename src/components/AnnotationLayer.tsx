import React, { useState, useRef } from 'react';
import { Annotation, AnnotationType, PageInfo } from '../pdf/types';

interface AnnotationLayerProps {
  page: PageInfo;
  scale: number;
  annotations: Annotation[];
  activeTool: AnnotationType | 'select';
  activeColor: string;
  strokeWidth: number;
  selectedId: string | null;
  onSelectAnnotation: (id: string | null) => void;
  onAddAnnotation: (annot: Annotation) => void;
  onUpdateAnnotation: (annot: Annotation) => void;
  onOpenNote: (annot: Annotation) => void;
}

export const AnnotationLayer: React.FC<AnnotationLayerProps> = ({
  page,
  scale,
  annotations,
  activeTool,
  activeColor,
  strokeWidth,
  selectedId,
  onSelectAnnotation,
  onAddAnnotation,
  onUpdateAnnotation,
  onOpenNote,
}) => {
  const cropBox = page.cropBox || page.mediaBox || [0, 0, 612, 792];
  const pageHeight = cropBox[3] - cropBox[1];
  const svgRef = useRef<SVGSVGElement | null>(null);

  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPath, setCurrentPath] = useState<Array<{ x: number; y: number }>>([]);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [tempRect, setTempRect] = useState<[number, number, number, number] | null>(null);
  const [resizingHandle, setResizingHandle] = useState<string | null>(null);
  const [movingStart, setMovingStart] = useState<{ x: number; y: number; origRect: [number, number, number, number] } | null>(null);

  const toScreenCoords = (pdfX: number, pdfY: number): [number, number] => {
    const x = (pdfX - cropBox[0]) * scale;
    const y = (pageHeight - (pdfY - cropBox[1])) * scale;
    return [x, y];
  };

  const toPdfCoords = (screenX: number, screenY: number): [number, number] => {
    const pdfX = cropBox[0] + screenX / scale;
    const pdfY = cropBox[3] - screenY / scale;
    return [pdfX, pdfY];
  };

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const [pdfX, pdfY] = toPdfCoords(screenX, screenY);

    if (activeTool === 'ink') {
      setIsDrawing(true);
      setCurrentPath([{ x: pdfX, y: pdfY }]);
    } else if (activeTool === 'rect' || activeTool === 'highlight' || activeTool === 'underline') {
      setIsDrawing(true);
      setDragStart({ x: pdfX, y: pdfY });
      setTempRect([pdfX, pdfY, pdfX, pdfY]);
    } else if (activeTool === 'note') {
      const newNote: Annotation = {
        id: 'note_' + Math.random().toString(36).substring(2, 9),
        type: 'note',
        pageIndex: page.index,
        color: activeColor,
        rect: [pdfX - 12, pdfY - 12, pdfX + 12, pdfY + 12],
        contents: 'Note comment',
        author: 'Reviewer',
        createdAt: Date.now(),
        modifiedAt: Date.now(),
      };
      onAddAnnotation(newNote);
      onSelectAnnotation(newNote.id);
      onOpenNote(newNote);
    } else if (activeTool === 'select') {
      if ((e.target as HTMLElement).tagName === 'svg') {
        onSelectAnnotation(null);
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const [pdfX, pdfY] = toPdfCoords(screenX, screenY);

    if (movingStart && selectedId) {
      const selectedAnnot = annotations.find((a) => a.id === selectedId);
      if (!selectedAnnot) return;
      const dx = pdfX - movingStart.x;
      const dy = pdfY - movingStart.y;
      const [ox1, oy1, ox2, oy2] = movingStart.origRect;
      const updated: Annotation = {
        ...selectedAnnot,
        rect: [ox1 + dx, oy1 + dy, ox2 + dx, oy2 + dy],
        modifiedAt: Date.now(),
      };
      onUpdateAnnotation(updated);
      return;
    }

    if (resizingHandle && selectedId) {
      const selectedAnnot = annotations.find((a) => a.id === selectedId);
      if (!selectedAnnot) return;
      const [x1, y1, x2, y2] = selectedAnnot.rect;
      let nx1 = x1, ny1 = y1, nx2 = x2, ny2 = y2;

      if (resizingHandle.includes('e')) nx2 = Math.max(nx1 + 10, pdfX);
      if (resizingHandle.includes('w')) nx1 = Math.min(nx2 - 10, pdfX);
      if (resizingHandle.includes('n')) ny2 = Math.max(ny1 + 10, pdfY);
      if (resizingHandle.includes('s')) ny1 = Math.min(ny2 - 10, pdfY);

      const updated: Annotation = {
        ...selectedAnnot,
        rect: [nx1, ny1, nx2, ny2],
        modifiedAt: Date.now(),
      };
      onUpdateAnnotation(updated);
      return;
    }

    if (!isDrawing) return;

    if (activeTool === 'ink') {
      setCurrentPath((prev) => [...prev, { x: pdfX, y: pdfY }]);
    } else if (dragStart && (activeTool === 'rect' || activeTool === 'highlight' || activeTool === 'underline')) {
      const minX = Math.min(dragStart.x, pdfX);
      const maxX = Math.max(dragStart.x, pdfX);
      const minY = Math.min(dragStart.y, pdfY);
      const maxY = Math.max(dragStart.y, pdfY);
      setTempRect([minX, minY, maxX, maxY]);
    }
  };

  const handlePointerUp = () => {
    if (movingStart) {
      setMovingStart(null);
    }
    if (resizingHandle) {
      setResizingHandle(null);
    }

    if (!isDrawing) return;
    setIsDrawing(false);

    if (activeTool === 'ink' && currentPath.length > 1) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of currentPath) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      const newInk: Annotation = {
        id: 'ink_' + Math.random().toString(36).substring(2, 9),
        type: 'ink',
        pageIndex: page.index,
        color: activeColor,
        strokeWidth,
        paths: [currentPath],
        rect: [minX - 5, minY - 5, maxX + 5, maxY + 5],
        createdAt: Date.now(),
        modifiedAt: Date.now(),
      };
      onAddAnnotation(newInk);
      setCurrentPath([]);
    } else if (tempRect && (activeTool === 'rect' || activeTool === 'highlight' || activeTool === 'underline')) {
      const [x1, y1, x2, y2] = tempRect;
      if (Math.abs(x2 - x1) > 4 && Math.abs(y2 - y1) > 4) {
        let newAnnot: Annotation;
        const id = `${activeTool}_${Math.random().toString(36).substring(2, 9)}`;
        if (activeTool === 'highlight') {
          newAnnot = {
            id,
            type: 'highlight',
            pageIndex: page.index,
            color: activeColor,
            rect: [x1, y1, x2, y2],
            createdAt: Date.now(),
            modifiedAt: Date.now(),
          };
        } else if (activeTool === 'underline') {
          newAnnot = {
            id,
            type: 'underline',
            pageIndex: page.index,
            color: activeColor,
            rect: [x1, y1, x2, y2],
            createdAt: Date.now(),
            modifiedAt: Date.now(),
          };
        } else {
          newAnnot = {
            id,
            type: 'rect',
            pageIndex: page.index,
            color: activeColor,
            strokeWidth,
            rect: [x1, y1, x2, y2],
            createdAt: Date.now(),
            modifiedAt: Date.now(),
          };
        }
        onAddAnnotation(newAnnot);
        onSelectAnnotation(newAnnot.id);
      }
      setTempRect(null);
      setDragStart(null);
    }
  };

  const renderAnnotation = (annot: Annotation) => {
    const isSelected = annot.id === selectedId;
    const [x1, y1] = toScreenCoords(annot.rect[0], annot.rect[3]);
    const [x2, y2] = toScreenCoords(annot.rect[2], annot.rect[1]);
    const width = Math.max(Math.abs(x2 - x1), 4);
    const height = Math.max(Math.abs(y2 - y1), 4);
    const screenLeft = Math.min(x1, x2);
    const screenTop = Math.min(y1, y2);

    const onAnnotClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      onSelectAnnotation(annot.id);
      if (annot.type === 'note') {
        onOpenNote(annot);
      }
    };

    const onStartMove = (e: React.PointerEvent) => {
      if (activeTool !== 'select') return;
      e.stopPropagation();
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const [px, py] = toPdfCoords(sx, sy);
      setMovingStart({ x: px, y: py, origRect: [...annot.rect] });
      onSelectAnnotation(annot.id);
    };

    return (
      <g
        key={annot.id}
        className={`annotation-item ${isSelected ? 'selected' : ''}`}
        onClick={onAnnotClick}
        onPointerDown={onStartMove}
      >
        {annot.type === 'highlight' && (
          <rect
            x={screenLeft}
            y={screenTop}
            width={width}
            height={height}
            fill={annot.color}
            fillOpacity={0.4}
            style={{ mixBlendMode: 'multiply' }}
          />
        )}

        {annot.type === 'underline' && (
          <line
            x1={screenLeft}
            y1={screenTop + height}
            x2={screenLeft + width}
            y2={screenTop + height}
            stroke={annot.color}
            strokeWidth={2 * scale}
          />
        )}

        {annot.type === 'rect' && (
          <rect
            x={screenLeft}
            y={screenTop}
            width={width}
            height={height}
            fill={annot.fillColor || 'transparent'}
            stroke={annot.color}
            strokeWidth={(annot.strokeWidth || 2) * scale}
            rx={2}
          />
        )}

        {annot.type === 'note' && (
          <g transform={`translate(${screenLeft}, ${screenTop})`}>
            <rect
              width={26}
              height={26}
              rx={6}
              fill={annot.color}
              stroke="#ffffff"
              strokeWidth={2}
              filter="drop-shadow(0 2px 4px rgba(0,0,0,0.2))"
            />
            <text
              x={13}
              y={17}
              fill="#ffffff"
              fontSize={12}
              fontWeight="bold"
              textAnchor="middle"
            >
              N
            </text>
          </g>
        )}

        {annot.type === 'ink' && (
          <g>
            {annot.paths.map((p, pIdx) => {
              if (p.length < 2) return null;
              const points = p.map((pt) => {
                const [sx, sy] = toScreenCoords(pt.x, pt.y);
                return `${sx.toFixed(1)},${sy.toFixed(1)}`;
              }).join(' ');
              return (
                <polyline
                  key={pIdx}
                  points={points}
                  fill="none"
                  stroke={annot.color}
                  strokeWidth={(annot.strokeWidth || 2) * scale}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              );
            })}
          </g>
        )}

        {isSelected && (
          <g className="selection-handles">
            <rect
              x={screenLeft - 2}
              y={screenTop - 2}
              width={width + 4}
              height={height + 4}
              fill="none"
              stroke="#2563eb"
              strokeWidth={1.5}
              strokeDasharray="4 4"
            />
            <circle
              cx={screenLeft}
              cy={screenTop}
              r={5}
              fill="#2563eb"
              stroke="#ffffff"
              strokeWidth={1.5}
              className="resize-handle handle-nw"
              onPointerDown={(e) => {
                e.stopPropagation();
                setResizingHandle('nw');
              }}
            />
            <circle
              cx={screenLeft + width}
              cy={screenTop}
              r={5}
              fill="#2563eb"
              stroke="#ffffff"
              strokeWidth={1.5}
              className="resize-handle handle-ne"
              onPointerDown={(e) => {
                e.stopPropagation();
                setResizingHandle('ne');
              }}
            />
            <circle
              cx={screenLeft + width}
              cy={screenTop + height}
              r={5}
              fill="#2563eb"
              stroke="#ffffff"
              strokeWidth={1.5}
              className="resize-handle handle-se"
              onPointerDown={(e) => {
                e.stopPropagation();
                setResizingHandle('se');
              }}
            />
            <circle
              cx={screenLeft}
              cy={screenTop + height}
              r={5}
              fill="#2563eb"
              stroke="#ffffff"
              strokeWidth={1.5}
              className="resize-handle handle-sw"
              onPointerDown={(e) => {
                e.stopPropagation();
                setResizingHandle('sw');
              }}
            />
          </g>
        )}
      </g>
    );
  };

  return (
    <svg
      ref={svgRef}
      className={`annotation-layer active-tool-${activeTool}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {annotations.map(renderAnnotation)}

      {isDrawing && activeTool === 'ink' && currentPath.length > 1 && (
        <polyline
          points={currentPath
            .map((pt) => {
              const [sx, sy] = toScreenCoords(pt.x, pt.y);
              return `${sx.toFixed(1)},${sy.toFixed(1)}`;
            })
            .join(' ')}
          fill="none"
          stroke={activeColor}
          strokeWidth={strokeWidth * scale}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      {isDrawing && tempRect && (
        <rect
          x={Math.min(toScreenCoords(tempRect[0], tempRect[3])[0], toScreenCoords(tempRect[2], tempRect[1])[0])}
          y={Math.min(toScreenCoords(tempRect[0], tempRect[3])[1], toScreenCoords(tempRect[2], tempRect[1])[1])}
          width={Math.abs(toScreenCoords(tempRect[2], tempRect[1])[0] - toScreenCoords(tempRect[0], tempRect[3])[0])}
          height={Math.abs(toScreenCoords(tempRect[2], tempRect[1])[1] - toScreenCoords(tempRect[0], tempRect[3])[1])}
          fill={activeTool === 'highlight' ? activeColor : 'transparent'}
          fillOpacity={activeTool === 'highlight' ? 0.35 : 0}
          stroke={activeColor}
          strokeWidth={activeTool === 'underline' ? 2 : strokeWidth * scale}
          strokeDasharray="3 3"
        />
      )}
    </svg>
  );
};
