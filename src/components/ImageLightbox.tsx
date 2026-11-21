import React, { useEffect } from 'react';
import { Download, X } from 'lucide-react';

interface ImageLightboxProps {
  src: string;
  name: string;
  onClose: () => void;
}

export const ImageLightbox: React.FC<ImageLightboxProps> = ({ src, name, onClose }) => {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="lightbox-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <a
          href={src}
          download={name}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-sm"
          style={{ textDecoration: 'none' }}
        >
          <Download size={13} />
          Download
        </a>
        <button type="button" className="btn btn-sm" onClick={onClose} aria-label="Close preview">
          <X size={14} />
          Close
        </button>
      </div>

      <img
        src={src}
        alt={name}
        className="lightbox-img"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
};
