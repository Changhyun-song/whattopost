/**
 * User feedback capture store.
 *
 * Captures user interaction events with analysis results:
 *   - photo_viewed      — opened in lightbox
 *   - photo_saved       — downloaded / saved
 *   - photo_dismissed   — explicitly marked as "not this one"
 *   - group_viewed      — navigated to a group page
 *
 * Derives higher-level signals:
 *   - recommendation_accepted   — saved a recommended photo
 *   - recommendation_overridden — saved a non-recommended photo
 *   - top1_selected / top3_selected / override patterns
 *
 * Persistence: localStorage (survives refresh, exportable as JSON).
 * Future: pluggable server endpoint via sendToServer().
 */

import * as analysisStore from './analysisStore';

// ─── Types ───────────────────────────────────────────────

export type FeedbackEventType =
  | 'photo_viewed'
  | 'photo_saved'
  | 'photo_dismissed'
  | 'recommendation_accepted'
  | 'recommendation_overridden'
  | 'group_viewed';

export interface FeedbackEvent {
  id: string;
  type: FeedbackEventType;
  timestamp: number;
  photoId: string | null;
  groupId: string | null;
  context: {
    wasRecommended?: boolean;
    wasRepresentative?: boolean;
    rank?: number;
    score?: number;
    alternatives?: string[];
  };
}

export type SessionFeedbackType =
  | 'top1_accepted'
  | 'top3_accepted'
  | 'recommendation_overridden'
  | 'mixed'
  | 'no_selection';

export interface UserSelectionFeedback {
  sessionId: string;
  uploadId: string;
  recommendedPhotoIds: string[];
  selectedPhotoIds: string[];
  dismissedPhotoIds: string[];
  chosenInsteadOfPhotoId: string | null;
  feedbackType: SessionFeedbackType;
  timestamp: number;
  context: {
    totalPhotos: number;
    totalGroups: number;
    totalCandidates: number;
    eventsCount: number;
    viewedCount: number;
    savedCount: number;
    dismissedCount: number;
  };
}

// ─── State ───────────────────────────────────────────────

let sessionId = '';
let uploadId = '';
const events: FeedbackEvent[] = [];
const dismissedIds = new Set<string>();
const savedIds = new Set<string>();
const viewedIds = new Set<string>();

const STORAGE_KEY = 'whattopost_feedback';

// ─── Init ────────────────────────────────────────────────

export function init(analysisUploadId?: string): void {
  if (!sessionId) {
    sessionId = `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  }
  if (analysisUploadId) uploadId = analysisUploadId;
  loadFromStorage();
}

// ─── Logging ─────────────────────────────────────────────

function makeId(): string {
  return `ev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function getPhotoContext(photoId: string, groupId?: string | null) {
  const result = analysisStore.getResult();
  if (!result) return {};

  const candidateIds = result.candidates.map((c) => c.fileId);
  const wasRecommended = candidateIds.includes(photoId);
  const candidate = result.candidates.find((c) => c.fileId === photoId);
  const rank = candidate
    ? result.candidates.indexOf(candidate)
    : result.allRanked.findIndex((r) => r.fileId === photoId);

  let wasRepresentative = false;
  if (groupId) {
    const group = result.groups.find((g) => g.id === groupId);
    wasRepresentative = group?.bestFileId === photoId;
  } else {
    wasRepresentative = result.groups.some((g) => g.bestFileId === photoId);
  }

  const score = result.allRanked.find((r) => r.fileId === photoId)?.score;

  return { wasRecommended, wasRepresentative, rank, score };
}

export function logPhotoViewed(photoId: string, groupId?: string): void {
  viewedIds.add(photoId);
  const ctx = getPhotoContext(photoId, groupId);
  pushEvent({
    id: makeId(),
    type: 'photo_viewed',
    timestamp: Date.now(),
    photoId,
    groupId: groupId ?? null,
    context: ctx,
  });
}

export function logPhotoSaved(photoId: string, groupId?: string): void {
  savedIds.add(photoId);
  const ctx = getPhotoContext(photoId, groupId);

  pushEvent({
    id: makeId(),
    type: 'photo_saved',
    timestamp: Date.now(),
    photoId,
    groupId: groupId ?? null,
    context: ctx,
  });

  // Derive recommendation signal
  if (ctx.wasRecommended) {
    pushEvent({
      id: makeId(),
      type: 'recommendation_accepted',
      timestamp: Date.now(),
      photoId,
      groupId: groupId ?? null,
      context: ctx,
    });
  } else {
    // Find what the recommendation was for this group
    const result = analysisStore.getResult();
    const group = groupId
      ? result?.groups.find((g) => g.id === groupId)
      : null;
    const recommendedInGroup = group?.bestFileId ?? null;

    pushEvent({
      id: makeId(),
      type: 'recommendation_overridden',
      timestamp: Date.now(),
      photoId,
      groupId: groupId ?? null,
      context: {
        ...ctx,
        alternatives: recommendedInGroup ? [recommendedInGroup] : [],
      },
    });
  }
}

export function logPhotoDismissed(photoId: string, groupId?: string): void {
  dismissedIds.add(photoId);
  const ctx = getPhotoContext(photoId, groupId);
  pushEvent({
    id: makeId(),
    type: 'photo_dismissed',
    timestamp: Date.now(),
    photoId,
    groupId: groupId ?? null,
    context: ctx,
  });
}

export function logGroupViewed(groupId: string): void {
  pushEvent({
    id: makeId(),
    type: 'group_viewed',
    timestamp: Date.now(),
    photoId: null,
    groupId,
    context: {},
  });
}

function pushEvent(event: FeedbackEvent): void {
  events.push(event);
  persistToStorage();
  console.log(`[feedback] ${event.type}`, event.photoId ?? event.groupId, event.context);
}

// ─── Query ───────────────────────────────────────────────

export function isDismissed(photoId: string): boolean {
  return dismissedIds.has(photoId);
}

export function isSaved(photoId: string): boolean {
  return savedIds.has(photoId);
}

export function getEvents(): FeedbackEvent[] {
  return [...events];
}

export function getSavedIds(): string[] {
  return Array.from(savedIds);
}

export function getDismissedIds(): string[] {
  return Array.from(dismissedIds);
}

// ─── Session Summary ─────────────────────────────────────

export function buildSessionSummary(): UserSelectionFeedback {
  const result = analysisStore.getResult();
  const recommendedIds = result?.candidates.map((c) => c.fileId) ?? [];
  const selected = Array.from(savedIds);
  const dismissed = Array.from(dismissedIds);

  let feedbackType: SessionFeedbackType = 'no_selection';
  let chosenInsteadOfPhotoId: string | null = null;

  if (selected.length > 0) {
    const allRecommended = selected.every((id) => recommendedIds.includes(id));
    const anyRecommended = selected.some((id) => recommendedIds.includes(id));

    if (allRecommended && selected.includes(recommendedIds[0])) {
      feedbackType = 'top1_accepted';
    } else if (allRecommended && selected.some((id) => recommendedIds.slice(0, 3).includes(id))) {
      feedbackType = 'top3_accepted';
    } else if (!anyRecommended) {
      feedbackType = 'recommendation_overridden';
      chosenInsteadOfPhotoId = selected[0];
    } else {
      feedbackType = 'mixed';
    }
  }

  return {
    sessionId,
    uploadId,
    recommendedPhotoIds: recommendedIds,
    selectedPhotoIds: selected,
    dismissedPhotoIds: dismissed,
    chosenInsteadOfPhotoId,
    feedbackType,
    timestamp: Date.now(),
    context: {
      totalPhotos: result?.totalCount ?? 0,
      totalGroups: result?.groupCount ?? 0,
      totalCandidates: result?.candidateCount ?? 0,
      eventsCount: events.length,
      viewedCount: viewedIds.size,
      savedCount: savedIds.size,
      dismissedCount: dismissedIds.size,
    },
  };
}

// ─── Persistence ─────────────────────────────────────────

function persistToStorage(): void {
  try {
    const data = {
      sessionId,
      uploadId,
      events,
      dismissedIds: Array.from(dismissedIds),
      savedIds: Array.from(savedIds),
      viewedIds: Array.from(viewedIds),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // localStorage full or unavailable
  }
}

function loadFromStorage(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.sessionId === sessionId) {
      // Same session, merge
      for (const ev of data.events ?? []) {
        if (!events.some((e) => e.id === ev.id)) events.push(ev);
      }
      for (const id of data.dismissedIds ?? []) dismissedIds.add(id);
      for (const id of data.savedIds ?? []) savedIds.add(id);
      for (const id of data.viewedIds ?? []) viewedIds.add(id);
    }
  } catch {
    // Corrupted data, ignore
  }
}

// ─── Export ──────────────────────────────────────────────

export function exportFeedbackJSON(): string {
  const summary = buildSessionSummary();
  return JSON.stringify({ summary, events }, null, 2);
}

export function downloadFeedbackJSON(): void {
  const json = exportFeedbackJSON();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `whattopost-feedback-${sessionId}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Reset ───────────────────────────────────────────────

export function clear(): void {
  events.length = 0;
  dismissedIds.clear();
  savedIds.clear();
  viewedIds.clear();
  sessionId = '';
  uploadId = '';
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
}

// ─── Server stub (future) ────────────────────────────────

export async function sendToServer(_endpoint?: string): Promise<void> {
  const summary = buildSessionSummary();
  console.log('[feedback] server payload ready:', summary);
  // Future: await fetch(endpoint, { method: 'POST', body: JSON.stringify(summary) });
}
