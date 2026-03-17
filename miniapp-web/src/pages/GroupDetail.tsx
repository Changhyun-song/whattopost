import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import * as analysisStore from '../lib/analysisStore';
import * as previewQueue from '../lib/previewQueue';
import * as fileStore from '../lib/fileStore';
import * as feedbackStore from '../lib/feedbackStore';
import Lightbox from '../components/Lightbox';
import type { RankedPhoto, Candidate } from '../lib/mockAnalysis';
import { getStrengthTags } from '../lib/imageScorer';

// ─── Small components ─────────────────────────────────

function StrengthChip({ label }: { label: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      fontSize: 11, fontWeight: 600, color: '#00a67e',
      background: '#edf9f5', borderRadius: 6, padding: '3px 7px',
      whiteSpace: 'nowrap',
    }}>
      <span style={{ fontSize: 10 }}>✓</span>{label}
    </span>
  );
}

function RejectChip({ reason }: { reason: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      fontSize: 11, fontWeight: 600, color: '#e5503c',
      background: '#ffeceb', borderRadius: 6, padding: '3px 7px',
      whiteSpace: 'nowrap',
    }}>
      ✕ {reason}
    </span>
  );
}

function CategoryBadge({ text, color, bg }: { text: string; color: string; bg: string }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, color, background: bg,
      borderRadius: 6, padding: '3px 8px', letterSpacing: -0.2,
    }}>
      {text}
    </span>
  );
}

function ScoreBar({ score, rejected }: { score: number; rejected: boolean }) {
  const pct = Math.round(score * 100);
  const color = rejected ? '#e5503c' : pct > 70 ? '#00b894' : pct > 40 ? '#ff8a00' : '#e5503c';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: '#f2f4f6', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: color, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: 13, fontWeight: 700, color: rejected ? '#e5503c' : '#333d4b', minWidth: 28, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {pct}
      </span>
    </div>
  );
}

function MetricPill({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <span style={{
      fontSize: 10, padding: '2px 5px', borderRadius: 4,
      background: warn ? '#ffeceb' : '#f2f4f6',
      color: warn ? '#e5503c' : '#8b95a1',
    }}>
      {label}{value}
    </span>
  );
}

// ─── Types ─────────────────────────────────────────────

type ViewMode = 'best' | 'excluded' | 'group';

function resolveView(id: string | undefined): ViewMode {
  if (id === 'best') return 'best';
  if (id === 'excluded') return 'excluded';
  return 'group';
}

// ─── Main ──────────────────────────────────────────────

export default function GroupDetail() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const result = analysisStore.getResult();
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [lightboxFileId, setLightboxFileId] = useState<string | null>(null);
  const [showExcluded, setShowExcluded] = useState(false);
  const [localDismissed, setLocalDismissed] = useState<Set<string>>(new Set());

  useEffect(() => { feedbackStore.init(); }, []);

  const mode = resolveView(id);

  const getPhotos = useCallback((): { kept: RankedPhoto[]; rejected: RankedPhoto[] } => {
    if (!result) return { kept: [], rejected: [] };

    if (mode === 'best') {
      const candidatePhotos: RankedPhoto[] = result.candidates.map((c: Candidate) => ({
        fileId: c.fileId, score: c.score, qualityScores: c.qualityScores,
        rejected: false, rejectReason: null,
        tags: getStrengthTags(c.qualityScores), reason: c.reason,
      }));
      return { kept: candidatePhotos, rejected: [] };
    }

    if (mode === 'excluded') {
      return { kept: [], rejected: result.allRanked.filter((p) => p.rejected) };
    }

    const group = result.groups.find((g) => g.id === id);
    if (!group) return { kept: [], rejected: [] };
    return {
      kept: group.ranked.filter((p) => !p.rejected),
      rejected: group.ranked.filter((p) => p.rejected),
    };
  }, [result, mode, id]);

  const { kept, rejected } = getPhotos();
  const allIds = [...kept, ...rejected].map((p) => p.fileId);
  const manifest = fileStore.getManifest();

  useEffect(() => {
    if (!result) { navigate('/', { replace: true }); return; }
    let cancelled = false;
    previewQueue.generatePreviews(allIds, (fid, url) => {
      if (!cancelled) setPreviews((prev) => ({ ...prev, [fid]: url }));
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, navigate, id]);

  if (!result) return null;

  const group = mode === 'group' ? result.groups.find((g) => g.id === id) : null;

  const title = mode === 'best' ? '전체 베스트' : mode === 'excluded' ? '제외된 사진' : group?.label ?? '장면';
  const subtitle = mode === 'best'
    ? `${result.totalCount}장 중 AI가 고른 최고의 사진`
    : mode === 'excluded'
      ? `품질 기준 미달 ${rejected.length}장`
      : `${(group?.keptCount ?? 0) + (group?.rejectedCount ?? 0)}장 중 ${group?.keptCount ?? 0}장 추천`;

  function fileName(fileId: string): string | undefined {
    return manifest.find((f) => f.id === fileId)?.name;
  }

  function candidateInfo(fileId: string): Candidate | undefined {
    return result!.candidates.find((c) => c.fileId === fileId);
  }

  function renderPhotoCard(photo: RankedPhoto, index: number, isBest = false) {
    const cand = mode === 'best' ? candidateInfo(photo.fileId) : undefined;
    const name = fileName(photo.fileId);
    const wasDismissed = localDismissed.has(photo.fileId);
    const isFirst = index === 0 && !photo.rejected && mode !== 'excluded';
    const qs = photo.qualityScores;

    return (
      <div
        key={photo.fileId}
        style={{
          borderRadius: 18,
          overflow: 'hidden',
          background: wasDismissed ? '#f9f9f9' : '#fff',
          boxShadow: isFirst ? '0 4px 20px rgba(49,130,246,0.12)' : '0 1px 8px rgba(0,0,0,0.05)',
          border: isFirst ? '2px solid #3182f6' : 'none',
          opacity: 0, animation: 'fadeUp 0.3s ease forwards',
          animationDelay: `${index * 0.04}s`,
          filter: wasDismissed ? 'grayscale(0.6)' : undefined,
          transition: 'filter 0.3s, background 0.3s',
        }}
      >
        {/* Image — full-width, larger aspect ratio */}
        <div
          onClick={() => {
            if (!previews[photo.fileId]) return;
            feedbackStore.logPhotoViewed(photo.fileId, mode === 'group' ? id : undefined);
            setLightboxFileId(photo.fileId);
          }}
          style={{
            width: '100%', aspectRatio: '3/2',
            overflow: 'hidden', background: '#f2f4f6',
            cursor: previews[photo.fileId] ? 'pointer' : 'default',
            position: 'relative',
          }}
        >
          {previews[photo.fileId] ? (
            <img
              src={previews[photo.fileId]} alt="" loading="lazy"
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          ) : (
            <div className="shimmer-box" />
          )}

          {(photo.rejected || wasDismissed) && (
            <div style={{
              position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{
                fontSize: 12, color: '#fff', fontWeight: 600,
                background: wasDismissed ? 'rgba(255,138,0,0.85)' : 'rgba(229,80,60,0.85)',
                padding: '5px 12px', borderRadius: 8,
              }}>
                {wasDismissed ? '관심없음' : '제외됨'}
              </span>
            </div>
          )}

          {/* Best badge */}
          {(isFirst || (cand && cand.category === 'best')) && !photo.rejected && (
            <div style={{ position: 'absolute', top: 10, left: 10 }}>
              <span style={{
                background: '#ff8a00', color: '#fff', fontSize: 11,
                fontWeight: 700, padding: '4px 10px', borderRadius: 8,
                boxShadow: '0 2px 8px rgba(255,138,0,0.3)',
              }}>
                👑 {isBest ? 'BEST' : '1위'}
              </span>
            </div>
          )}

          {/* Score badge on image */}
          <div style={{
            position: 'absolute', bottom: 8, right: 8,
            background: 'rgba(0,0,0,0.6)', color: '#fff',
            fontSize: 12, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
            fontVariantNumeric: 'tabular-nums',
          }}>
            {(photo.score * 100).toFixed(0)}점
          </div>
        </div>

        {/* Info section */}
        <div style={{ padding: '12px 14px 14px' }}>
          {/* Category badge */}
          {cand && (
            <div style={{ marginBottom: 8 }}>
              <CategoryBadge
                text={cand.tag}
                color={cand.category === 'best' ? '#fff' : cand.category === 'profile' ? '#3182f6' : '#00b894'}
                bg={cand.category === 'best' ? '#ff8a00' : cand.category === 'profile' ? '#e8f3ff' : '#e6f7f2'}
              />
            </div>
          )}

          {/* Score bar */}
          <ScoreBar score={photo.score} rejected={photo.rejected} />

          {/* Metrics pills */}
          <div style={{ display: 'flex', gap: 3, marginTop: 6, flexWrap: 'wrap' }}>
            <MetricPill label="S" value={(qs.sharpness * 100).toFixed(0)} />
            <MetricPill label="E" value={(qs.exposure * 100).toFixed(0)} />
            {qs.faceCount > 0 && (
              <>
                <MetricPill label="Eye" value={(qs.eyeOpen * 100).toFixed(0)} warn={qs.eyeOpen < 0.3} />
                <MetricPill label="Ex" value={(qs.expression * 100).toFixed(0)} />
                <MetricPill label="F" value={String(qs.faceCount)} />
              </>
            )}
          </div>

          {/* Reason */}
          <p style={{
            fontSize: 13, fontWeight: 600, lineHeight: 1.4, letterSpacing: -0.2, marginTop: 8,
            color: photo.rejected ? '#8b95a1' : '#333d4b',
          }}>
            {photo.reason}
          </p>

          {/* Tags */}
          {!photo.rejected && photo.tags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
              {photo.tags.slice(0, 4).map((t) => <StrengthChip key={t} label={t} />)}
            </div>
          )}

          {photo.rejected && photo.rejectReason && (
            <div style={{ marginTop: 8 }}>
              <RejectChip reason={photo.rejectReason} />
            </div>
          )}

          {/* Filename */}
          {name && (
            <p style={{ fontSize: 11, color: '#adb5bd', marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {name}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      {/* Header */}
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={() => navigate('/result')}
          style={{ fontSize: 22, color: '#333d4b', padding: '4px 8px 4px 0', lineHeight: 1 }}
        >
          ‹
        </button>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.3 }}>{title}</h1>
          <p style={{ fontSize: 12, color: '#8b95a1', marginTop: 2 }}>{subtitle}</p>
        </div>
      </div>

      <div className="page-body" style={{ gap: 16, paddingTop: 4, paddingBottom: 80 }}>
        {/* Kept photos — single column for large cards */}
        {kept.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {kept.map((p, i) => renderPhotoCard(p, i, mode === 'best'))}
          </div>
        )}

        {/* Excluded toggle */}
        {mode === 'group' && rejected.length > 0 && (
          <div>
            <button
              onClick={() => setShowExcluded(!showExcluded)}
              style={{
                width: '100%', textAlign: 'left', padding: '14px 16px',
                background: '#fff8f8', borderRadius: 14,
                display: 'flex', alignItems: 'center', gap: 10,
              }}
            >
              <span style={{ fontSize: 16 }}>🚫</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#333d4b', flex: 1 }}>
                제외된 사진 {rejected.length}장
              </span>
              <span style={{ fontSize: 14, color: '#adb5bd', transition: 'transform 0.2s', transform: showExcluded ? 'rotate(90deg)' : 'none' }}>›</span>
            </button>

            {showExcluded && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
                {rejected.map((p, i) => renderPhotoCard(p, i))}
              </div>
            )}
          </div>
        )}

        {/* Excluded view */}
        {mode === 'excluded' && rejected.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {rejected.map((p, i) => renderPhotoCard(p, i))}
          </div>
        )}

        {/* Empty */}
        {kept.length === 0 && rejected.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#adb5bd' }}>
            <p style={{ fontSize: 32, marginBottom: 8 }}>📭</p>
            <p style={{ fontSize: 14 }}>표시할 사진이 없어요</p>
          </div>
        )}
      </div>

      <div className="page-footer">
        <button className="btn-secondary" onClick={() => navigate('/result')}>
          결과 목록으로
        </button>
      </div>

      {/* Lightbox with navigation */}
      {lightboxFileId && previews[lightboxFileId] && (() => {
        const navList = [...kept, ...(showExcluded || mode === 'excluded' ? rejected : [])];
        const navIdx = navList.findIndex((p) => p.fileId === lightboxFileId);
        const bestFileId = group?.bestFileId ?? (mode === 'best' && kept.length > 0 ? kept[0].fileId : null);
        const currentPhoto = navList[navIdx];

        const goTo = (idx: number) => {
          const target = navList[idx];
          if (target && previews[target.fileId]) setLightboxFileId(target.fileId);
        };

        return (
          <Lightbox
            src={previews[lightboxFileId]}
            filename={fileName(lightboxFileId)}
            fileId={lightboxFileId}
          faceBoxes={result.faceDebug?.[lightboxFileId]?.faces}
          rawFaceCount={result.faceDebug?.[lightboxFileId]?.rawFaceCount}
          worstEAR={result.faceDebug?.[lightboxFileId]?.worstEAR}
          isBest={lightboxFileId === bestFileId}
            score={currentPhoto?.score}
            currentIndex={navIdx >= 0 ? navIdx : undefined}
            totalCount={navList.length}
            onClose={() => setLightboxFileId(null)}
            onPrev={navIdx > 0 ? () => goTo(navIdx - 1) : undefined}
            onNext={navIdx < navList.length - 1 ? () => goTo(navIdx + 1) : undefined}
            onSave={(fid) => feedbackStore.logPhotoSaved(fid, mode === 'group' ? id : undefined)}
            onDismiss={(fid) => {
              feedbackStore.logPhotoDismissed(fid, mode === 'group' ? id : undefined);
              setLocalDismissed((prev) => new Set(prev).add(fid));
            }}
          />
        );
      })()}
    </div>
  );
}
