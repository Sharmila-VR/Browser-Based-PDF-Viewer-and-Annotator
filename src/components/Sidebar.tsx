import React, { useState } from 'react';
import { OutlineItem, PageInfo, SearchMatch } from '../pdf/types';

export type SidebarTab = 'thumbnails' | 'outlines' | 'search';

interface SidebarProps {
  isOpen: boolean;
  activeTab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  onClose: () => void;
  pages: PageInfo[];
  currentPage: number;
  onGoToPage: (pageIndex: number) => void;
  outlines: OutlineItem[];
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onSearchSubmit: () => void;
  searchMatches: SearchMatch[];
  currentMatchIndex: number;
  onNextMatch: () => void;
  onPrevMatch: () => void;
  isSearching: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  activeTab,
  onTabChange,
  onClose,
  pages,
  currentPage,
  onGoToPage,
  outlines,
  searchQuery,
  onSearchChange,
  onSearchSubmit,
  searchMatches,
  currentMatchIndex,
  onNextMatch,
  onPrevMatch,
  isSearching,
}) => {
  if (!isOpen) return null;

  const renderOutlines = (items: OutlineItem[], level = 0) => {
    return (
      <ul className={`outline-list level-${level}`}>
        {items.map((item, idx) => (
          <li key={idx} className="outline-item">
            <button
              type="button"
              className="outline-link"
              onClick={() => {
                if (item.pageIndex !== undefined) {
                  onGoToPage(item.pageIndex);
                }
              }}
            >
              {item.title}
            </button>
            {item.children && item.children.length > 0 && renderOutlines(item.children, level + 1)}
          </li>
        ))}
      </ul>
    );
  };

  return (
    <aside className="sidebar-container" aria-label="Document Navigation Sidebar">
      <div className="sidebar-header">
        <div className="sidebar-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'thumbnails'}
            className={`tab-btn ${activeTab === 'thumbnails' ? 'active' : ''}`}
            onClick={() => onTabChange('thumbnails')}
          >
            Pages
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'outlines'}
            className={`tab-btn ${activeTab === 'outlines' ? 'active' : ''}`}
            onClick={() => onTabChange('outlines')}
          >
            Outlines
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'search'}
            className={`tab-btn ${activeTab === 'search' ? 'active' : ''}`}
            onClick={() => onTabChange('search')}
          >
            Search
          </button>
        </div>
        <button
          type="button"
          className="btn-text btn-sidebar-close"
          onClick={onClose}
          aria-label="Close sidebar"
        >
          Hide
        </button>
      </div>

      <div className="sidebar-content">
        {activeTab === 'thumbnails' && (
          <div className="thumbnails-grid">
            {pages.map((p) => {
              const isActive = p.index === currentPage;
              return (
                <div
                  key={p.index}
                  className={`thumbnail-card ${isActive ? 'active' : ''}`}
                  onClick={() => onGoToPage(p.index)}
                >
                  <div className="thumbnail-preview">
                    <span className="thumbnail-num">{p.index + 1}</span>
                  </div>
                  <span className="thumbnail-label">Page {p.index + 1}</span>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === 'outlines' && (
          <div className="outlines-view">
            {outlines.length === 0 ? (
              <div className="empty-message">No bookmarks or outlines available in this document.</div>
            ) : (
              renderOutlines(outlines)
            )}
          </div>
        )}

        {activeTab === 'search' && (
          <div className="search-view">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                onSearchSubmit();
              }}
              className="search-form"
            >
              <div className="search-input-wrapper">
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => onSearchChange(e.target.value)}
                  placeholder="Search in document..."
                  className="search-input"
                  aria-label="Search term"
                />
                <button type="submit" className="btn-primary btn-search-go">
                  Find
                </button>
              </div>
            </form>

            <div className="search-controls">
              <span className="search-count">
                {isSearching
                  ? 'Searching...'
                  : searchMatches.length > 0
                  ? `Match ${currentMatchIndex + 1} of ${searchMatches.length}`
                  : searchQuery
                  ? 'No matches found'
                  : 'Enter text to search'}
              </span>
              <div className="search-nav-btns">
                <button
                  type="button"
                  className="btn-secondary btn-nav"
                  onClick={onPrevMatch}
                  disabled={searchMatches.length === 0}
                  aria-label="Previous match"
                >
                  Prev
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-nav"
                  onClick={onNextMatch}
                  disabled={searchMatches.length === 0}
                  aria-label="Next match"
                >
                  Next
                </button>
              </div>
            </div>

            <div className="search-results-list">
              {searchMatches.map((m, idx) => (
                <div
                  key={idx}
                  className={`search-result-item ${idx === currentMatchIndex ? 'active' : ''}`}
                  onClick={() => onGoToPage(m.pageIndex)}
                >
                  <div className="search-result-meta">Page {m.pageIndex + 1}</div>
                  <div className="search-result-snippet">{m.context}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
