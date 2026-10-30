import React, { useState } from 'react';
import { Annotation } from '../pdf/types';

interface NoteModalProps {
  annotation: Annotation;
  onSave: (updated: Annotation) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export const NoteModal: React.FC<NoteModalProps> = ({
  annotation,
  onSave,
  onDelete,
  onClose,
}) => {
  const [contents, setContents] = useState(annotation.contents || '');
  const [author, setAuthor] = useState(annotation.author || 'Reviewer');

  const handleSave = () => {
    onSave({
      ...annotation,
      contents,
      author,
      modifiedAt: Date.now(),
    });
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="note-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="note-modal-header">
          <div className="note-modal-title">Sticky Note Comment</div>
          <button
            type="button"
            className="btn-text btn-close"
            onClick={onClose}
            aria-label="Close Note"
          >
            Close
          </button>
        </div>

        <div className="note-modal-body">
          <div className="form-group">
            <label htmlFor="note-author">Author</label>
            <input
              id="note-author"
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              className="input-text"
            />
          </div>

          <div className="form-group">
            <label htmlFor="note-content">Comment</label>
            <textarea
              id="note-content"
              rows={4}
              value={contents}
              onChange={(e) => setContents(e.target.value)}
              className="input-textarea"
              placeholder="Enter comment here..."
              autoFocus
            />
          </div>

          <div className="note-meta">
            Created: {new Date(annotation.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>

        <div className="note-modal-footer">
          <button
            type="button"
            className="btn-danger"
            onClick={() => {
              onDelete(annotation.id);
              onClose();
            }}
          >
            Delete Note
          </button>
          <div className="footer-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={handleSave}>
              Save Note
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
