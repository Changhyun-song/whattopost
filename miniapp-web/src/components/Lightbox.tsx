import { useEffect, useState, useRef, useCallback } from 'react';

export interface FaceBox {
  box: { x: number; y: number; w: number; h: number };
  confidence: number;
  size: number;
  ear: number;
  minEyeEAR?: number;
  normEAR?: number;
  eyeContrast?: number;
  /** MediaPipe blink score: 0 = open, 1 = closed, -1 = unavailable */
  eyeBlinkScore?: number;
  expression?: string;
}

interface LightboxProps {
  src: string;
  filename?: string;
  fileId?: string;
  faceBoxes?: FaceBox[];
  rawFaceCount?: number;
  worstEAR?: number;
  isBest?: boolean;
  score?: number;
  currentIndex?: number;
  totalCount?: number;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onSave?: (fileId: string) => void;
  onDismiss?: (fileId: string) => void;
}

const ZOOM_FACTOR = 2.5;
const FACE_COLORS = ['#00ff88', '#ff6b6b', '#4ecdc4', '#ffe66d', '#a29bfe', '#fd79a8', '#74b9ff', '#ffeaa7'];

const NAV_BTN: React.CSSProperties = {
  position: 'absolute', top: '50%', transform: 'translateY(-50%)',
  width: 44, height: 44, borderRadius: '50%',
  background: 'rgba(255,255,255,0.15)', color: '#fff',
  fontSize: 22, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer', zIndex: 10, backdropFilter: 'blur(4px)',
  transition: 'background 0.15s',
};

export default function Lightbox({
  src, filename, fileId, faceBoxes, rawFaceCount, worstEAR, isBest, score,
  currentIndex, totalCount,
  onClose, onPrev, onNext, onSave, onDismiss,
}: LightboxProps) {
  const [saved, setSaved] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [zooming, setZooming] = useState(false);
  const [zoomPos, setZoomPos] = useState({ x: 50, y: 50 });
  const [showFaces, setShowFaces] = useState(false);
  const imgRef = useRef<HTMLDivElement>(null);

  // Reset per-photo state on navigation
  useEffect(() => {
    setSaved(false);
    setDismissed(false);
    setShowFaces(false);
  }, [fileId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && onPrev) { e.preventDefault(); onPrev(); }
      if (e.key === 'ArrowRight' && onNext) { e.preventDefault(); onNext(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, onPrev, onNext]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = imgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setZoomPos({ x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) });
  }, []);

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    const a = document.createElement('a');
    a.href = src;
    a.download = filename || 'photo.jpg';
    a.click();
    setSaved(true);
    if (fileId && onSave) onSave(fileId);
  };

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDismissed(true);
    if (fileId && onDismiss) onDismiss(fileId);
    setTimeout(onClose, 400);
  };

  const hasFaces = faceBoxes && faceBoxes.length > 0;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.92)',
        zIndex: 1000,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '16px 12px',
        animation: 'fadeUp 0.2s ease',
      }}
    >
      {/* Navigation arrows — outside image container */}
      {onPrev && (
        <div
          onClick={(e) => { e.stopPropagation(); onPrev(); }}
          style={{ ...NAV_BTN, left: 12 }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.3)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.15)')}
        >
          ‹
        </div>
      )}
      {onNext && (
        <div
          onClick={(e) => { e.stopPropagation(); onNext(); }}
          style={{ ...NAV_BTN, right: 12 }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.3)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.15)')}
        >
          ›
        </div>
      )}

      {/* Counter + Best badge bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10,
        minHeight: 28,
      }}>
        {isBest && (
          <span style={{
            background: '#ff8a00', color: '#fff', fontSize: 12,
            fontWeight: 700, padding: '4px 12px', borderRadius: 8,
            boxShadow: '0 2px 8px rgba(255,138,0,0.3)',
          }}>
            👑 BEST
          </span>
        )}
        {score != null && (
          <span style={{
            background: 'rgba(255,255,255,0.15)', color: '#fff',
            fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 8,
          }}>
            {(score * 100).toFixed(0)}점
          </span>
        )}
        {currentIndex != null && totalCount != null && (
          <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 500 }}>
            {currentIndex + 1} / {totalCount}
          </span>
        )}
      </div>

      {/* Image container with zoom */}
      <div
        ref={imgRef}
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={() => setZooming(true)}
        onMouseLeave={() => setZooming(false)}
        onMouseMove={handleMouseMove}
        style={{
          position: 'relative',
          maxWidth: '90vw',
          maxHeight: '72vh',
          overflow: 'hidden',
          borderRadius: 12,
          cursor: zooming ? 'crosshair' : 'default',
          boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
        }}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          style={{
            display: 'block',
            maxWidth: '90vw',
            maxHeight: '72vh',
            objectFit: 'contain',
            opacity: dismissed ? 0.3 : 1,
            transition: 'opacity 0.3s',
          }}
        />

        {/* Zoom lens overlay */}
        {zooming && !dismissed && !showFaces && (
          <div
            style={{
              position: 'absolute', inset: 0,
              backgroundImage: `url(${src})`,
              backgroundSize: `${ZOOM_FACTOR * 100}% ${ZOOM_FACTOR * 100}%`,
              backgroundPosition: `${zoomPos.x}% ${zoomPos.y}%`,
              backgroundRepeat: 'no-repeat',
              opacity: 1,
              pointerEvents: 'none',
            }}
          />
        )}

        {/* Face detection boxes overlay */}
        {showFaces && hasFaces && (
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            {faceBoxes!.map((face, i) => {
              const blink = face.eyeBlinkScore ?? -1;
              const hasBlink = blink >= 0;

              // Primary: MediaPipe blink score. Fallback: EAR-based (multi-tier).
              const ear = face.ear ?? 1;
              const expr = face.expression ?? '';
              const isEyeClosed = hasBlink
                ? blink > 0.45
                : (ear < 0.20 || (ear < 0.25 && expr !== 'happy') || (ear < 0.28 && expr === 'sad'));

              const blinkPct = hasBlink ? (blink * 100).toFixed(0) : null;
              const blinkColor = hasBlink
                ? (blink > 0.45 ? '#ff2222' : blink > 0.25 ? '#ffaa00' : '#00ff00')
                : '#888';

              const borderColor = isEyeClosed ? '#ff2222' : FACE_COLORS[i % FACE_COLORS.length];
              const tagBg = isEyeClosed ? '#ff2222' : FACE_COLORS[i % FACE_COLORS.length];
              return (
                <div key={i}>
                  <div style={{
                    position: 'absolute',
                    left: `${face.box.x * 100}%`,
                    top: `${face.box.y * 100}%`,
                    width: `${face.box.w * 100}%`,
                    height: `${face.box.h * 100}%`,
                    border: `${isEyeClosed ? 3 : 2}px solid ${borderColor}`,
                    borderRadius: 4,
                    boxShadow: isEyeClosed ? `0 0 12px ${borderColor}cc` : `0 0 6px ${borderColor}88`,
                  }} />
                  {isEyeClosed && (
                    <div style={{
                      position: 'absolute',
                      left: `${(face.box.x + face.box.w / 2) * 100}%`,
                      top: `${(face.box.y + face.box.h / 2) * 100}%`,
                      transform: 'translate(-50%, -50%)',
                      background: 'rgba(255,0,0,0.85)',
                      color: '#fff',
                      fontSize: 12,
                      fontWeight: 800,
                      padding: '3px 8px',
                      borderRadius: 6,
                      whiteSpace: 'nowrap',
                    }}>
                      눈감김
                    </div>
                  )}
                  {/* Top tag: metrics */}
                  <div style={{
                    position: 'absolute',
                    left: `${face.box.x * 100}%`,
                    top: `${(face.box.y) * 100}%`,
                    transform: 'translateY(-100%)',
                    background: tagBg,
                    color: isEyeClosed ? '#fff' : '#000',
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '1px 5px',
                    borderRadius: '4px 4px 0 0',
                    whiteSpace: 'nowrap',
                  }}>
                    #{i + 1} {(face.confidence * 100).toFixed(0)}%
                    {hasBlink ? (
                      <span style={{ color: blinkColor, marginLeft: 3 }}>
                        blink:{blinkPct}%
                      </span>
                    ) : (
                      <span style={{ color: '#888', marginLeft: 3 }}>
                        EAR:{(face.normEAR ?? 0).toFixed(2)}
                      </span>
                    )}
                    {face.expression && (
                      <span style={{ marginLeft: 3 }}>{face.expression}</span>
                    )}
                  </div>
                  {/* Bottom tag: verdict */}
                  <div style={{
                    position: 'absolute',
                    left: `${face.box.x * 100}%`,
                    top: `${(face.box.y + face.box.h) * 100}%`,
                    background: 'rgba(0,0,0,0.8)',
                    color: isEyeClosed ? '#ff6666' : '#aaffaa',
                    fontSize: 9,
                    fontWeight: 600,
                    padding: '1px 4px',
                    borderRadius: '0 0 4px 4px',
                    whiteSpace: 'nowrap',
                  }}>
                    sz:{(face.size*100).toFixed(0)}% {hasBlink ? `MP:${blink.toFixed(2)}` : `EAR:${face.ear.toFixed(3)}`} {isEyeClosed ? '✕ CLOSED' : '✓ OPEN'}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Face count badge */}
        {showFaces && faceBoxes && (
          <div style={{
            position: 'absolute', top: 10, left: 10,
            background: 'rgba(0,0,0,0.75)', color: '#fff',
            fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 8,
            pointerEvents: 'none',
          }}>
            감지: {faceBoxes.length}명
            {worstEAR != null && (
              <span style={{ color: worstEAR < 0.65 ? '#ff4444' : '#4ade80', marginLeft: 6 }}>
                worstEAR:{worstEAR.toFixed(2)}
              </span>
            )}
            {rawFaceCount != null && rawFaceCount > faceBoxes.length && (
              <span style={{ color: '#ff8a00', marginLeft: 4 }}>
                (NMS 제거 {rawFaceCount - faceBoxes.length})
              </span>
            )}
            {(() => {
              const closedCount = faceBoxes.filter((f) => {
                const b = f.eyeBlinkScore ?? -1;
                if (b >= 0) return b > 0.45;
                const e = f.ear ?? 1;
                const ex = f.expression ?? '';
                return e < 0.20 || (e < 0.25 && ex !== 'happy') || (e < 0.28 && ex === 'sad');
              }).length;
              return closedCount > 0 ? (
                <span style={{ color: '#ff2222', marginLeft: 6, fontWeight: 800 }}>
                  눈감김 {closedCount}명
                </span>
              ) : null;
            })()}
          </div>
        )}

        {/* Zoom indicator */}
        {zooming && !dismissed && !showFaces && (
          <div style={{
            position: 'absolute', top: 10, right: 10,
            background: 'rgba(0,0,0,0.6)', color: '#fff',
            fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 8,
            pointerEvents: 'none',
          }}>
            {ZOOM_FACTOR}x
          </div>
        )}
      </div>

      {/* Status messages */}
      {saved && (
        <p style={{ color: '#00b894', fontSize: 13, fontWeight: 600, marginTop: 10, animation: 'fadeUp 0.2s ease' }}>
          ✓ 저장됨
        </p>
      )}
      {dismissed && (
        <p style={{ color: '#ff8a00', fontSize: 13, fontWeight: 600, marginTop: 10, animation: 'fadeUp 0.2s ease' }}>
          ✕ 제외됨
        </p>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 8, marginTop: saved || dismissed ? 8 : 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        {hasFaces && (
          <button
            onClick={(e) => { e.stopPropagation(); setShowFaces(!showFaces); }}
            style={{
              padding: '10px 16px', borderRadius: 10,
              background: showFaces ? '#a29bfe' : 'rgba(162,155,254,0.2)',
              color: showFaces ? '#fff' : '#a29bfe',
              fontSize: 13, fontWeight: 600, letterSpacing: -0.2,
              transition: 'all 0.2s',
            }}
          >
            {showFaces ? `얼굴 ${faceBoxes!.length}개` : '얼굴 보기'}
          </button>
        )}

        <button
          onClick={handleDownload}
          style={{
            padding: '10px 22px', borderRadius: 10,
            background: saved ? '#00b894' : '#3182f6',
            color: '#fff', fontSize: 13, fontWeight: 600,
            letterSpacing: -0.2, transition: 'background 0.2s',
          }}
        >
          {saved ? '✓ 저장됨' : '저장'}
        </button>

        {onDismiss && fileId && !dismissed && (
          <button
            onClick={handleDismiss}
            style={{
              padding: '10px 16px', borderRadius: 10,
              background: 'rgba(255,138,0,0.15)', color: '#ff8a00',
              fontSize: 13, fontWeight: 600, letterSpacing: -0.2,
            }}
          >
            제외
          </button>
        )}

        <button
          onClick={onClose}
          style={{
            padding: '10px 16px', borderRadius: 10,
            background: 'rgba(255,255,255,0.12)', color: '#fff',
            fontSize: 13, fontWeight: 600, letterSpacing: -0.2,
          }}
        >
          닫기
        </button>
      </div>

      {/* Filename + hint */}
      <div style={{ textAlign: 'center', marginTop: 8 }}>
        {filename && <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>{filename}</p>}
        <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, marginTop: 3 }}>
          ← → 방향키로 사진 넘기기 · 마우스 올리면 확대
        </p>
      </div>
    </div>
  );
}
