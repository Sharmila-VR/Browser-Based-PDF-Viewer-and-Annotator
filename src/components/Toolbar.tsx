import React from 'react';
import { AnnotationType } from '../pdf/types';

interface ToolbarProps {
  pageCount: number;
  currentPage: number;
  scale: number;
  rotation: number;
  activeTool: AnnotationType | 'select';
  activeColor: string;
  strokeWidth: number;
  canUndo: boolean;
  canRedo: boolean;
  canDelete: boolean;
  isSidebarOpen: boolean;
  highContrast: boolean;
  onToggleSidebar: () => void;
  onGoToPage: (pageIndex: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitWidth: () => void;
  onFitPage: () => void;
  onRotate: () => void;
  onSelectTool: (tool: AnnotationType | 'select') => void;
  onSelectColor: (color: string) => void;
  onSelectStrokeWidth: (width: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onDeleteSelected: () => void;
  onToggleContrast: () => void;
  onOpenFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onLoadSample: () => void;
  onLoadBenchmark: () => void;
  onSavePdf: () => void;
}

const PALETTE = [
  { name: 'Yellow', value: '#ffd60a' },
  { name: 'Green', value: '#30d158' },
  { name: 'Blue', value: '#0a84ff' },
  { name: 'Pink', value: '#ff375f' },
  { name: 'Orange', value: '#ff9f0a' },
];

export const Toolbar: React.FC<ToolbarProps> = ({
  pageCount,
  currentPage,
  scale,
  rotation,
  activeTool,
  activeColor,
  strokeWidth,
  canUndo,
  canRedo,
  canDelete,
  isSidebarOpen,
  highContrast,
  onToggleSidebar,
  onGoToPage,
  onZoomIn,
  onZoomOut,
  onFitWidth,
  onFitPage,
  onRotate,
  onSelectTool,
  onSelectColor,
  onSelectStrokeWidth,
  onUndo,
  onRedo,
  onDeleteSelected,
  onToggleContrast,
  onOpenFile,
  onLoadSample,
  onLoadBenchmark,
  onSavePdf,
}) => {
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  return (
    <header className="app-toolbar" role="toolbar" aria-label="PDF Controls Toolbar">
      <div className="toolbar-section">
        <button
          type="button"
          className={`toolbar-btn ${isSidebarOpen ? 'active' : ''}`}
          onClick={onToggleSidebar}
          aria-label="Toggle Sidebar Navigation"
        >
          Sidebar
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          onChange={onOpenFile}
          style={{ display: 'none' }}
        />

        <button
          type="button"
          className="toolbar-btn"
          onClick={() => fileInputRef.current?.click()}
          aria-label="Open PDF from Disk"
        >
          Open File
        </button>

        <button
          type="button"
          className="toolbar-btn"
          onClick={onLoadSample}
          aria-label="Load Standard Sample PDF"
        >
          Sample
        </button>

        <button
          type="button"
          className="toolbar-btn"
          onClick={onLoadBenchmark}
          aria-label="Load 200-Page Benchmark PDF"
        >
          200-Page Demo
        </button>

        <button
          type="button"
          className="toolbar-btn btn-accent"
          onClick={onSavePdf}
          aria-label="Save PDF with standard incremental annotations"
        >
          Save PDF
        </button>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-section">
        <div className="page-indicator">
          <span>Page</span>
          <input
            type="number"
            min={1}
            max={Math.max(1, pageCount)}
            value={currentPage + 1}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              if (!isNaN(val) && val >= 1 && val <= pageCount) {
                onGoToPage(val - 1);
              }
            }}
            className="page-input"
            aria-label="Current Page Number"
          />
          <span>of {pageCount}</span>
        </div>

        <button
          type="button"
          className="toolbar-btn"
          onClick={onZoomOut}
          aria-label="Zoom Out"
        >
          Zoom Out
        </button>

        <span className="zoom-label">{Math.round(scale * 100)}%</span>

        <button
          type="button"
          className="toolbar-btn"
          onClick={onZoomIn}
          aria-label="Zoom In"
        >
          Zoom In
        </button>

        <button
          type="button"
          className="toolbar-btn"
          onClick={onFitWidth}
          aria-label="Fit Page Width"
        >
          Fit Width
        </button>

        <button
          type="button"
          className="toolbar-btn"
          onClick={onFitPage}
          aria-label="Fit Entire Page"
        >
          Fit Page
        </button>

        <button
          type="button"
          className="toolbar-btn"
          onClick={onRotate}
          aria-label="Rotate Page 90 Degrees"
        >
          Rotate
        </button>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-section">
        <button
          type="button"
          className={`toolbar-btn tool-btn ${activeTool === 'select' ? 'active' : ''}`}
          onClick={() => onSelectTool('select')}
          aria-label="Select and Move Tool"
        >
          Select
        </button>

        <button
          type="button"
          className={`toolbar-btn tool-btn ${activeTool === 'highlight' ? 'active' : ''}`}
          onClick={() => onSelectTool('highlight')}
          aria-label="Text Highlight Tool"
        >
          Highlight
        </button>

        <button
          type="button"
          className={`toolbar-btn tool-btn ${activeTool === 'underline' ? 'active' : ''}`}
          onClick={() => onSelectTool('underline')}
          aria-label="Text Underline Tool"
        >
          Underline
        </button>

        <button
          type="button"
          className={`toolbar-btn tool-btn ${activeTool === 'ink' ? 'active' : ''}`}
          onClick={() => onSelectTool('ink')}
          aria-label="Freehand Ink Drawing Tool"
        >
          Draw
        </button>

        <button
          type="button"
          className={`toolbar-btn tool-btn ${activeTool === 'note' ? 'active' : ''}`}
          onClick={() => onSelectTool('note')}
          aria-label="Sticky Note Tool"
        >
          Note
        </button>

        <button
          type="button"
          className={`toolbar-btn tool-btn ${activeTool === 'rect' ? 'active' : ''}`}
          onClick={() => onSelectTool('rect')}
          aria-label="Rectangle Shape Tool"
        >
          Rectangle
        </button>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-section">
        <div className="color-swatches" role="radiogroup" aria-label="Annotation Color">
          {PALETTE.map((c) => (
            <button
              key={c.value}
              type="button"
              className={`color-swatch ${activeColor === c.value ? 'selected' : ''}`}
              style={{ backgroundColor: c.value }}
              onClick={() => onSelectColor(c.value)}
              title={c.name}
              aria-label={c.name}
            />
          ))}
        </div>

        <div className="stroke-selector">
          {[1, 2, 4].map((w) => (
            <button
              key={w}
              type="button"
              className={`toolbar-btn btn-sm ${strokeWidth === w ? 'active' : ''}`}
              onClick={() => onSelectStrokeWidth(w)}
            >
              {w}pt
            </button>
          ))}
        </div>

        <button
          type="button"
          className="toolbar-btn btn-sm"
          onClick={onUndo}
          disabled={!canUndo}
          aria-label="Undo Annotation Operation"
        >
          Undo
        </button>

        <button
          type="button"
          className="toolbar-btn btn-sm"
          onClick={onRedo}
          disabled={!canRedo}
          aria-label="Redo Annotation Operation"
        >
          Redo
        </button>

        <button
          type="button"
          className="toolbar-btn btn-sm btn-delete"
          onClick={onDeleteSelected}
          disabled={!canDelete}
          aria-label="Delete Selected Annotation"
        >
          Delete
        </button>

        <button
          type="button"
          className={`toolbar-btn btn-sm ${highContrast ? 'active' : ''}`}
          onClick={onToggleContrast}
          aria-label="Toggle High Contrast Mode"
        >
          Contrast
        </button>
      </div>
    </header>
  );
};
