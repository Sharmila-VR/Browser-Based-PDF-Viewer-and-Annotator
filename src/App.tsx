import React, { useState, useEffect, useRef, useTransition } from 'react';
import { PDFDocument } from './pdf/document';
import { Annotation, AnnotationType, SearchMatch } from './pdf/types';
import { WorkerRenderClient } from './pdf/workerClient';
import { createBenchmarkPdf, createSamplePdf } from './samples/samplePdf';
import { saveAnnotationsToDB, loadAnnotationsFromDB } from './storage/db';
import { Toolbar } from './components/Toolbar';
import { Sidebar, SidebarTab } from './components/Sidebar';
import { Viewport } from './components/Viewport';
import { NoteModal } from './components/NoteModal';
import './App.css';

export const App: React.FC = () => {
  const [doc, setDoc] = useState<PDFDocument | null>(null);
  const [docId, setDocId] = useState<string>('sample_doc');
  const [scale, setScale] = useState<number>(1.2);
  const [rotation, setRotation] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(0);

  const [activeTool, setActiveTool] = useState<AnnotationType | 'select'>('select');
  const [activeColor, setActiveColor] = useState<string>('#ffd60a');
  const [strokeWidth, setStrokeWidth] = useState<number>(2);
  const [selectedAnnotId, setSelectedAnnotId] = useState<string | null>(null);

  const [history, setHistory] = useState<Array<Map<number, Annotation[]>>>([]);
  const [historyIdx, setHistoryIdx] = useState<number>(-1);

  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('thumbnails');

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchMatches, setSearchMatches] = useState<SearchMatch[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState<number>(0);
  const [isSearching, setIsSearching] = useState<boolean>(false);

  const [activeNote, setActiveNote] = useState<Annotation | null>(null);
  const [highContrast, setHighContrast] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');

  const workerClientRef = useRef<WorkerRenderClient | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    workerClientRef.current = new WorkerRenderClient();
    loadInitialSample();

    return () => {
      workerClientRef.current?.destroy();
    };
  }, []);

  const loadInitialSample = async () => {
    try {
      showStatus('Loading sample PDF...');
      const sampleBytes = createSamplePdf(3);
      await loadPdfBytes(sampleBytes, 'sample_3pages');
      showStatus('Sample PDF loaded successfully.');
    } catch {
      showStatus('Failed to load sample.');
    }
  };

  const loadPdfBytes = async (bytes: Uint8Array, id: string) => {
    const newDoc = new PDFDocument(bytes);
    await newDoc.load();

    const savedAnnots = await loadAnnotationsFromDB(id);
    if (savedAnnots) {
      newDoc.annotations = savedAnnots;
    }

    if (workerClientRef.current) {
      await workerClientRef.current.initDocument(bytes);
    }

    setDoc(newDoc);
    setDocId(id);
    setCurrentPage(0);
    setSelectedAnnotId(null);
    setSearchMatches([]);
    setSearchQuery('');

    const initialHistoryMap = new Map<number, Annotation[]>();
    for (const [p, list] of newDoc.annotations.entries()) {
      initialHistoryMap.set(p, [...list]);
    }
    setHistory([initialHistoryMap]);
    setHistoryIdx(0);
  };

  const showStatus = (msg: string) => {
    setStatusMessage(msg);
    setTimeout(() => {
      setStatusMessage('');
    }, 3000);
  };

  const cloneAnnotationsMap = (map: Map<number, Annotation[]>): Map<number, Annotation[]> => {
    const copy = new Map<number, Annotation[]>();
    for (const [k, v] of map.entries()) {
      copy.set(k, v.map((item) => ({ ...item })));
    }
    return copy;
  };

  const commitAnnotationState = (newAnnotations: Map<number, Annotation[]>) => {
    if (!doc) return;
    doc.annotations = newAnnotations;

    const nextHistory = history.slice(0, historyIdx + 1);
    nextHistory.push(cloneAnnotationsMap(newAnnotations));
    setHistory(nextHistory);
    setHistoryIdx(nextHistory.length - 1);

    saveAnnotationsToDB(docId, newAnnotations);
    setDoc(Object.assign(Object.create(Object.getPrototypeOf(doc)), doc));
  };

  const handleAddAnnotation = (annot: Annotation) => {
    if (!doc) return;
    const current = cloneAnnotationsMap(doc.annotations);
    const pageList = current.get(annot.pageIndex) || [];
    current.set(annot.pageIndex, [...pageList, annot]);
    commitAnnotationState(current);
  };

  const handleUpdateAnnotation = (updated: Annotation) => {
    if (!doc) return;
    const current = cloneAnnotationsMap(doc.annotations);
    const pageList = current.get(updated.pageIndex) || [];
    const idx = pageList.findIndex((a) => a.id === updated.id);
    if (idx !== -1) {
      pageList[idx] = updated;
      current.set(updated.pageIndex, [...pageList]);
      commitAnnotationState(current);
    }
  };

  const handleDeleteAnnotation = (id: string) => {
    if (!doc) return;
    const current = cloneAnnotationsMap(doc.annotations);
    for (const [p, list] of current.entries()) {
      const filtered = list.filter((a) => a.id !== id);
      if (filtered.length !== list.length) {
        current.set(p, filtered);
        break;
      }
    }
    if (selectedAnnotId === id) {
      setSelectedAnnotId(null);
    }
    commitAnnotationState(current);
  };

  const handleUndo = () => {
    if (historyIdx > 0 && doc) {
      const targetState = cloneAnnotationsMap(history[historyIdx - 1]);
      doc.annotations = targetState;
      setHistoryIdx(historyIdx - 1);
      saveAnnotationsToDB(docId, targetState);
      setDoc(Object.assign(Object.create(Object.getPrototypeOf(doc)), doc));
    }
  };

  const handleRedo = () => {
    if (historyIdx < history.length - 1 && doc) {
      const targetState = cloneAnnotationsMap(history[historyIdx + 1]);
      doc.annotations = targetState;
      setHistoryIdx(historyIdx + 1);
      saveAnnotationsToDB(docId, targetState);
      setDoc(Object.assign(Object.create(Object.getPrototypeOf(doc)), doc));
    }
  };

  const handleTextSelected = (rect: [number, number, number, number], text: string) => {
    if (activeTool === 'highlight' || activeTool === 'underline') {
      const newAnnot: Annotation = {
        id: `${activeTool}_${Math.random().toString(36).substring(2, 9)}`,
        type: activeTool,
        pageIndex: currentPage,
        color: activeColor,
        rect,
        contents: text,
        createdAt: Date.now(),
        modifiedAt: Date.now(),
      };
      handleAddAnnotation(newAnnot);
    }
  };

  const handleSearchSubmit = async () => {
    if (!doc || !searchQuery.trim()) return;
    setIsSearching(true);
    startTransition(async () => {
      const matches = await doc.search(searchQuery);
      setSearchMatches(matches);
      setCurrentMatchIndex(0);
      setIsSearching(false);
      if (matches.length > 0) {
        goToPage(matches[0].pageIndex);
      }
    });
  };

  const handleNextMatch = () => {
    if (searchMatches.length === 0) return;
    const nextIdx = (currentMatchIndex + 1) % searchMatches.length;
    setCurrentMatchIndex(nextIdx);
    goToPage(searchMatches[nextIdx].pageIndex);
  };

  const handlePrevMatch = () => {
    if (searchMatches.length === 0) return;
    const prevIdx = (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length;
    setCurrentMatchIndex(prevIdx);
    goToPage(searchMatches[prevIdx].pageIndex);
  };

  const goToPage = (pageIndex: number) => {
    if (!doc || pageIndex < 0 || pageIndex >= doc.pages.length) return;
    setCurrentPage(pageIndex);
    const el = document.getElementById(`page-container-${pageIndex}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleOpenFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    showStatus(`Loading ${file.name}...`);
    const reader = new FileReader();
    reader.onload = async () => {
      if (reader.result instanceof ArrayBuffer) {
        const bytes = new Uint8Array(reader.result);
        await loadPdfBytes(bytes, file.name);
        showStatus(`${file.name} loaded.`);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleSavePdf = () => {
    if (!doc) return;
    try {
      showStatus('Building incremental PDF update...');
      const outputBytes = doc.saveWithAnnotations();
      const blob = new Blob([outputBytes as any], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${docId}_annotated.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      showStatus('PDF exported with standard annotations.');
    } catch (err: any) {
      showStatus('Save error: ' + (err?.message || String(err)));
    }
  };

  const handleLoadBenchmark = async () => {
    showStatus('Generating 200-page benchmark document...');
    setTimeout(async () => {
      const benchmarkBytes = createBenchmarkPdf(200);
      await loadPdfBytes(benchmarkBytes, 'benchmark_200pages');
      showStatus('200-page benchmark document loaded.');
    }, 50);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setIsSidebarOpen(true);
        setSidebarTab('search');
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedAnnotId && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
          handleDeleteAnnotation(selectedAnnotId);
        }
      }
      if (e.key === 'Escape') {
        setSelectedAnnotId(null);
        setActiveNote(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  return (
    <div className={`app-root ${highContrast ? 'high-contrast' : ''}`}>
      <Toolbar
        pageCount={doc?.pages.length || 0}
        currentPage={currentPage}
        scale={scale}
        rotation={rotation}
        activeTool={activeTool}
        activeColor={activeColor}
        strokeWidth={strokeWidth}
        canUndo={historyIdx > 0}
        canRedo={historyIdx < history.length - 1}
        canDelete={selectedAnnotId !== null}
        isSidebarOpen={isSidebarOpen}
        highContrast={highContrast}
        onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
        onGoToPage={goToPage}
        onZoomIn={() => setScale((s) => Math.min(s + 0.15, 3.5))}
        onZoomOut={() => setScale((s) => Math.max(s - 0.15, 0.4))}
        onFitWidth={() => setScale(1.4)}
        onFitPage={() => setScale(0.95)}
        onRotate={() => setRotation((r) => (r + 90) % 360)}
        onSelectTool={setActiveTool}
        onSelectColor={setActiveColor}
        onSelectStrokeWidth={setStrokeWidth}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onDeleteSelected={() => selectedAnnotId && handleDeleteAnnotation(selectedAnnotId)}
        onToggleContrast={() => setHighContrast((c) => !c)}
        onOpenFile={handleOpenFile}
        onLoadSample={loadInitialSample}
        onLoadBenchmark={handleLoadBenchmark}
        onSavePdf={handleSavePdf}
      />

      <div className="app-workspace">
        {doc && (
          <Sidebar
            isOpen={isSidebarOpen}
            activeTab={sidebarTab}
            onTabChange={setSidebarTab}
            onClose={() => setIsSidebarOpen(false)}
            pages={doc.pages}
            currentPage={currentPage}
            onGoToPage={goToPage}
            outlines={doc.outlines}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onSearchSubmit={handleSearchSubmit}
            searchMatches={searchMatches}
            currentMatchIndex={currentMatchIndex}
            onNextMatch={handleNextMatch}
            onPrevMatch={handlePrevMatch}
            isSearching={isSearching}
          />
        )}

        {doc && workerClientRef.current ? (
          <Viewport
            doc={doc}
            workerClient={workerClientRef.current}
            scale={scale}
            rotation={rotation}
            activeTool={activeTool}
            activeColor={activeColor}
            strokeWidth={strokeWidth}
            selectedAnnotId={selectedAnnotId}
            searchMatches={searchMatches}
            currentMatchIndex={currentMatchIndex}
            onPageChange={setCurrentPage}
            onSelectAnnotation={setSelectedAnnotId}
            onAddAnnotation={handleAddAnnotation}
            onUpdateAnnotation={handleUpdateAnnotation}
            onOpenNote={setActiveNote}
            onTextSelected={handleTextSelected}
            onWheelZoom={(delta) => setScale((s) => Math.max(0.4, Math.min(3.5, s + delta)))}
          />
        ) : (
          <div className="empty-workspace">
            <div className="empty-title">Loading PDF document...</div>
          </div>
        )}
      </div>

      {activeNote && (
        <NoteModal
          annotation={activeNote}
          onSave={handleUpdateAnnotation}
          onDelete={handleDeleteAnnotation}
          onClose={() => setActiveNote(null)}
        />
      )}

      {statusMessage && (
        <div className="status-toast" role="status" aria-live="polite">
          {statusMessage}
        </div>
      )}
    </div>
  );
};

export default App;

