import { useRef, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import * as fileStore from '../lib/fileStore';
import type { FileEntry } from '../lib/fileStore';
import * as previewQueue from '../lib/previewQueue';

const PREVIEW_LIMIT = 9;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export default function PhotoUpload() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const signalRef = useRef<{ cancelled: boolean }>({ cancelled: false });
  const [manifest, setManifest] = useState<FileEntry[]>(fileStore.getManifest);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [ingesting, setIngesting] = useState(false);

  const count = manifest.length;
  const totalSize = manifest.reduce((s, f) => s + f.size, 0);
  const visibleItems = manifest.slice(0, PREVIEW_LIMIT);
  const overflowCount = Math.max(0, count - PREVIEW_LIMIT);

  const loadPreviews = useCallback((entries: FileEntry[]) => {
    signalRef.current.cancelled = true;
    const signal = { cancelled: false };
    signalRef.current = signal;

    const ids = entries.slice(0, PREVIEW_LIMIT).map((f) => f.id);
    previewQueue.generatePreviews(
      ids,
      (id, url) => {
        if (!signal.cancelled) setPreviews((prev) => ({ ...prev, [id]: url }));
      },
      signal,
    );
  }, []);

  useEffect(() => {
    if (count > 0) loadPreviews(manifest);
    return () => { signalRef.current.cancelled = true; };
  }, [count, manifest, loadPreviews]);

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIngesting(true);
    const snapshot = Array.from(files);
    e.target.value = '';

    requestAnimationFrame(() => {
      fileStore.ingestFiles(snapshot);
      const updated = [...fileStore.getManifest()];
      setManifest(updated);
      setIngesting(false);
    });
  };

  const handleClear = () => {
    signalRef.current.cancelled = true;
    fileStore.clear();
    previewQueue.revokeAll();
    setManifest([]);
    setPreviews({});
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: -0.3 }}>
          사진 선택
        </h1>
      </div>

      <div className="page-body" style={{ gap: 16, paddingTop: 12, paddingBottom: 80 }}>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFiles}
          style={{ display: 'none' }}
        />

        {count === 0 && !ingesting ? (
          <>
            <p style={{ fontSize: 14, color: '#8b95a1', lineHeight: 1.5 }}>
              비슷한 사진을 한꺼번에 올려주세요.
              <br />
              많을수록 더 정확하게 골라드려요.
            </p>
            <button
              onClick={() => inputRef.current?.click()}
              style={{
                border: '1.5px dashed #d1d6db',
                borderRadius: 16,
                padding: '56px 0',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 8,
                color: '#8b95a1',
                transition: 'border-color 0.15s',
              }}
            >
              <span
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 14,
                  background: '#f2f4f6',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 24,
                  color: '#6b7684',
                }}
              >
                +
              </span>
              <span style={{ fontSize: 14 }}>탭해서 사진 추가</span>
            </button>
          </>
        ) : count === 0 && ingesting ? (
          <div
            style={{
              padding: '56px 0',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12,
              color: '#8b95a1',
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                border: '3px solid #e5e8eb',
                borderTopColor: '#3182f6',
                borderRadius: '50%',
                animation: 'spin 0.7s linear infinite',
              }}
            />
            <span style={{ fontSize: 14 }}>사진을 불러오는 중...</span>
          </div>
        ) : (
          <>
            {/* Stats bar */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: 17, fontWeight: 700, color: '#191f28' }}>
                  {count}장
                </span>
                <span style={{ fontSize: 13, color: '#adb5bd' }}>
                  {formatBytes(totalSize)}
                </span>
                {ingesting && (
                  <span
                    style={{
                      fontSize: 11,
                      color: '#3182f6',
                      fontWeight: 600,
                      animation: 'pulse 1s infinite',
                    }}
                  >
                    추가 중...
                  </span>
                )}
              </div>
              <button
                onClick={handleClear}
                style={{ fontSize: 13, color: '#8b95a1', padding: '4px 0' }}
              >
                전체 삭제
              </button>
            </div>

            {/* Preview grid */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 6,
              }}
            >
              {visibleItems.map((item) => (
                <div
                  key={item.id}
                  style={{
                    aspectRatio: '1',
                    borderRadius: 10,
                    overflow: 'hidden',
                    background: '#f2f4f6',
                  }}
                >
                  {previews[item.id] ? (
                    <img
                      src={previews[item.id]}
                      alt=""
                      loading="lazy"
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        display: 'block',
                        animation: 'fadeUp 0.25s ease',
                      }}
                    />
                  ) : (
                    <div className="shimmer-box" />
                  )}
                </div>
              ))}

              {/* Overflow / add-more cell */}
              <button
                onClick={() => inputRef.current?.click()}
                style={{
                  aspectRatio: '1',
                  borderRadius: 10,
                  background: overflowCount > 0 ? '#f2f4f6' : undefined,
                  border: overflowCount > 0 ? 'none' : '1.5px dashed #d1d6db',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 2,
                  color: '#6b7684',
                  transition: 'background 0.15s',
                }}
              >
                {overflowCount > 0 ? (
                  <>
                    <span style={{ fontSize: 17, fontWeight: 700 }}>+{overflowCount}</span>
                    <span style={{ fontSize: 11, color: '#8b95a1' }}>더보기</span>
                  </>
                ) : (
                  <span style={{ fontSize: 22 }}>+</span>
                )}
              </button>
            </div>

            {/* Hint */}
            <p style={{ fontSize: 12, color: '#adb5bd', textAlign: 'center', marginTop: 4 }}>
              사진을 더 추가하려면 + 버튼을 눌러주세요
            </p>
          </>
        )}
      </div>

      <div className="page-footer">
        <button
          className="btn-primary"
          disabled={count === 0 || ingesting}
          onClick={() => navigate('/processing')}
        >
          {count > 0 ? `${count}장 분석하기` : '사진을 선택해주세요'}
        </button>
      </div>
    </div>
  );
}
