# 뭐 올리지? — AI 기반 여행 사진 큐레이션 미니앱

> 수천 장의 여행 사진 중 "올릴 만한 사진"을 자동으로 골라주는 온-디바이스 AI 사진 분석 서비스

## 프로젝트 개요

여행을 다녀오면 보통 1,000~3,000장의 사진이 쌓입니다. 이 중 SNS에 올릴 만한 사진을 고르는 건 생각보다 고된 작업입니다. **"뭐 올리지?"** 는 브라우저에서 직접 돌아가는 머신러닝 모델들을 조합하여, 서버 업로드 없이 사용자의 디바이스에서 사진을 분석하고 장면별 베스트컷을 추천하는 토스 WebView 미니앱입니다.

### 핵심 목표

- **프라이버시 우선**: 사진이 서버로 전송되지 않음 — 모든 분석이 브라우저 내 on-device로 실행
- **대량 처리**: 수백~수천 장을 UI 프리징 없이 처리하는 비동기 파이프라인
- **실용적 추천**: 단순 화질이 아닌, "사람이 잘 나왔는가"를 기준으로 판단

---

## 기술 스택

| 영역 | 기술 | 역할 |
|------|------|------|
| **프론트엔드** | React 18 + TypeScript 5.9 | UI 프레임워크 |
| **빌드** | Vite 8 | 번들링 및 개발 서버 |
| **플랫폼** | Toss WebView MiniApp | 토스 앱 내 WebView 환경 |
| **얼굴 탐지** | `@vladmandic/face-api` (TF.js) | SSD MobileNet V1 / TinyFaceDetector 기반 얼굴 위치·표정·랜드마크·descriptor 추출 |
| **눈 감김 감지** | `@mediapipe/tasks-vision` | FaceLandmarker + Blendshape로 ML 기반 눈 깜빡임 점수 산출 |
| **이미지 분석** | Canvas API | 선명도(라플라시안), 노출, 구도, 얼굴 블러 측정 |
| **장면 분류** | 자체 구현 pHash + 임베딩 | 색상 히스토그램 + 구조 해시 기반 장면 유사도 클러스터링 |
| **라우팅** | React Router v7 | 페이지 전환 |

---

## 시스템 아키텍처

### 2-Phase 분석 파이프라인

대량의 사진을 효율적으로 처리하기 위해 분석을 두 단계로 분리했습니다.

```
Phase 1: Quick Scan (초 단위)
┌──────────┐    ┌───────────────┐    ┌──────────────┐
│  사진 선택  │───▶│  256px 리사이즈  │───▶│  장면 분류     │
│  (N장)    │    │  pHash 임베딩   │    │  (시간+유사도)  │
└──────────┘    └───────────────┘    └──────────────┘
                                           │
                      사용자가 장면 선택 ◀────┘

Phase 2: Deep Analysis (장면 단위)
┌──────────────┐    ┌─────────────────┐    ┌──────────────┐    ┌───────────┐
│  선택된 장면   │───▶│  Feature 추출     │───▶│  그룹 분할     │───▶│ 랭킹 & 필터 │
│  (40~100장)  │    │  (얼굴·화질·구도)  │    │  (인원·프레임)  │    │ (베스트컷)  │
└──────────────┘    └─────────────────┘    └──────────────┘    └───────────┘
```

이 구조를 통해 360장 기준으로 Quick Scan은 약 22초, 선택된 장면의 Deep Analysis는 약 29초에 완료됩니다. 전체를 한 번에 분석하는 것 대비 사용자가 원하는 장면만 골라서 분석할 수 있어 체감 대기 시간이 크게 줄어듭니다.

### 데이터 흐름

```
사진 선택 → fileStore (File 관리)
         → previewQueue (Object URL 썸네일)
         → Quick Scan → quickScanStore (장면 분류 결과)
         → Deep Analysis → analysisStore (그룹·점수·추천 결과)
         → 결과 화면 → feedbackStore (사용자 피드백 수집)
```

---

## 5단계 Deep Analysis 파이프라인

### Stage 0 — 모델 로딩

브라우저 환경에서 4개의 face-api.js 모델과 MediaPipe FaceLandmarker를 비동기 로드합니다.

| 모델 | 크기 | 역할 |
|------|------|------|
| SSD MobileNet V1 | ~5.8MB | 주 얼굴 탐지기 (높은 정확도) |
| TinyFaceDetector | ~0.2MB | 폴백 탐지기 |
| Face Landmark 68pt | ~0.4MB | 68개 얼굴 랜드마크 (눈, 코, 입) |
| Face Expression | ~0.3MB | 7가지 표정 분류 |
| Face Recognition | ~6.2MB | 128차원 얼굴 임베딩 (동일인 판별) |
| MediaPipe FaceLandmarker | ~3.6MB (CDN) | 478점 랜드마크 + 52개 Blendshape (눈 감김 정밀 감지) |

### Stage 1 — Feature Extraction

각 사진에서 추출하는 특성:

- **기술 품질**: 라플라시안 선명도(blur), 노출(exposure), 클리핑, 얼굴 영역 블러
- **얼굴 정보**: 위치, 크기, 표정, EAR(Eye Aspect Ratio), MediaPipe 눈 감김 점수, 128-dim descriptor
- **구도**: Rule-of-thirds 준수도, 배경 단순도
- **메타데이터**: EXIF 타임스탬프, 장면 임베딩(pHash)
- **사진 유형**: `selfie`, `travel_portrait`, `group_photo`, `landscape`, `food` 등 자동 분류

### Stage 2 — Scene Grouping

시간적 근접성(10분 이내)과 시각적 유사도(pHash 임베딩 코사인 거리)를 결합하여 장면을 묶습니다.

### Stage 3 — Fine Group Splitting

같은 장면 내에서도 인원수 변화, 프레이밍 변화(wide ↔ close-up), 얼굴 구성 변화를 감지하여 하위 그룹으로 분리합니다.

### Stage 4 — 다축 스코어링 & 랭킹

5개 축의 가중 합산으로 최종 점수를 산출합니다:

| 축 | 가중치 | 측정 항목 |
|----|--------|----------|
| Technical | 0.20 | 선명도, 노출, 클리핑 |
| Subject | 0.35 | 눈 뜸 정도, 얼굴 크기, 표정 품질, 얼굴 잘림 |
| Composition | 0.15 | 중심 정렬, 삼분할 |
| Context | 0.15 | 사진 유형별 보너스 (단체사진 인원 가중치 등) |
| Uniqueness | 0.15 | 연사 중복 패널티 |

### Stage 5 — Hard Filter & Explainability

품질 기준 미달 사진을 제외하고, 각 결정에 대한 설명을 생성합니다:

- `EYE_CLOSED`: 눈 감은 사람 있음
- `BLUR_SEVERE`: 심한 흔들림
- `FACE_CUT`: 얼굴 잘림
- `EXPOSURE_EXTREME`: 극심한 노출 문제
- `GROUP_TRIM`: 그룹 내 하위 품질

---

## 핵심 기술적 도전과 해결 과정

### 1. 장면 분류 — "너무 세세하게 나뉘는" 문제

**문제**: 초기 장면 분류가 같은 장소에서 찍은 사진들을 과도하게 분리했습니다. 같은 배경인데도 살짝 각도가 다르면 별도 장면으로 분류되어 사용성이 떨어졌습니다.

**해결**:
- 시간 기반 클러스터링과 시각적 유사도 병합을 2단계로 적용
- 동일 장면 유지 규칙(scene merge rule)을 도입하여 시간차 10분 이내 + 임베딩 유사도 높은 사진들을 병합
- 결과: 360장 → 37~40개 장면으로 적절한 세분화 달성

### 2. 얼굴 탐지 정확도 — 오탐지와 중복 감지

**문제**: face-api.js SSD MobileNet이 손, 배경 물체를 얼굴로 인식하거나, 같은 얼굴을 2번 잡는 경우가 발생했습니다.

**해결**:
- `minConfidence`를 0.50으로 상향하여 저신뢰 탐지 제거
- NMS(Non-Maximum Suppression) 파이프라인 구현: IoU 기반 중복 제거
- 배경 얼굴 필터: 얼굴 크기 비율이 극단적으로 작은 경우 배경 인물로 분류
- EAR sanity check(`ear > 0.45`)로 비정상 랜드마크 감지 제거

### 3. 눈 감김 감지 — 가장 어려웠던 핵심 문제

이 프로젝트에서 가장 많은 반복적 개선이 필요했던 영역입니다. "눈 감은 사진은 무조건 제외"라는 단순한 요구사항이 기술적으로는 매우 도전적이었습니다.

#### 3-1. 첫 번째 시도: EAR (Eye Aspect Ratio) 휴리스틱

face-api.js의 68개 랜드마크에서 눈 주변 6개 점의 비율로 EAR 값을 계산했습니다.

```
EAR = (||p2-p6|| + ||p3-p5||) / (2 × ||p1-p4||)
```

**결과**: 실패. 동양인 눈의 경우 뜬 상태에서도 EAR이 0.22~0.25로 낮게 나왔고, 감은 상태에서도 0.67처럼 비정상적으로 높게 나오는 경우가 있었습니다. 68점 랜드마크의 해상도가 정밀한 눈 분석에 부족했습니다.

#### 3-2. 두 번째 시도: 5-Tier 교차 검증

EAR에 눈 영역 픽셀 분석(밝기 대비), 표정 정보, 얼굴 크기를 조합하는 5단계 필터를 구현했습니다.

**결과**: 부분적 개선이지만 여전히 불안정. 픽셀 분석(`eyeContrast`)이 항상 1.0을 반환하는 버그, 작은 얼굴에서 픽셀 데이터 부족 등 새로운 문제가 연쇄적으로 발생했습니다.

#### 3-3. 세 번째 시도: MediaPipe FaceLandmarker 도입

face-api.js의 근본적 한계를 인식하고, Google MediaPipe의 478점 랜드마크 + 52개 Blendshape 모델로 전환을 결정했습니다. `eyeBlinkLeft` / `eyeBlinkRight` blendshape가 ML 기반으로 직접 눈 감김 확률을 출력합니다.

**문제 1 — 초기화 레이스 컨디션**: `initEyeState()`를 `await` 없이 호출하여 이미지 분석이 모델 로딩보다 먼저 시작되는 문제 발생. → `await initEyeState()` 로 수정.

**문제 2 — GPU delegate 블렌드셰이프 버그**: WebGL delegate에서 blendshapes 배열이 항상 비어 있음. → CPU delegate로 전환하여 해결.

**문제 3 — 전체 이미지에서 얼굴 0개 탐지**: 가장 큰 난관. CPU delegate, VIDEO 모드, CDN 모델 로딩 등 모든 조합을 시도했지만, 1536×2048 전체 이미지를 MediaPipe에 전달하면 `landmarks=0, blendshapes=0`이 반환되었습니다. face-api.js는 같은 이미지에서 2개 얼굴을 95% 신뢰도로 잡는 상황.

#### 3-4. 돌파구: Face Crop → MediaPipe 파이프라인

**핵심 아이디어**: 두 라이브러리의 장점을 결합하는 하이브리드 접근법.

```
face-api.js (SSD) → 얼굴 위치 탐지 (이건 잘 됨, 95%+ 신뢰도)
        ↓
  각 얼굴 bbox를 원본 비트맵에서 크롭 + 70% 패딩 + 384~512px 확대
        ↓
  크롭된 클로즈업 이미지를 MediaPipe에 전달
        ↓
  MediaPipe → 정확한 blendshape blink score 반환
```

face-api.js가 "어디에 얼굴이 있는지"를 찾고, MediaPipe가 "그 얼굴이 눈을 감았는지"를 판단하는 역할 분담입니다. 전체 이미지(6%짜리 작은 얼굴)가 아닌 크롭된 클로즈업(384×384 가득 찬 얼굴)을 주니 MediaPipe의 탐지 성공률이 극적으로 향상되었습니다.

#### 3-5. 미세 조정: 셀카 각도 False Positive 보정

크롭 방식 도입 후 MediaPipe가 작동하기 시작했지만, 셀카 각도(아래에서 위로 촬영)에서 한쪽 눈이 과도하게 높은 blink score를 받는 false positive가 발생했습니다.

**원인**: `blinkScore = Math.max(blinkLeft, blinkRight)` → 카메라 각도로 한쪽 눈만 감긴 것처럼 보이면, max 연산으로 전체가 "감김"으로 판정.

**해결**:
```typescript
// 양쪽 눈 평균 사용 — 실제 눈 감김은 양쪽 모두 높음
const avg = (blinkLeft + blinkRight) / 2;
const diff = Math.abs(blinkLeft - blinkRight);

// 좌우 불일치가 크면 카메라 각도 artifact → 신뢰도 감점
const blinkScore = diff > 0.3 ? avg * 0.7 : avg;
```

### 4. 대규모 사진 처리 — 1,000장 이상

**문제**: 여행 사진 1,000~3,000장을 한 번에 분석하면 feature extraction에만 수 분이 걸리고 UI가 프리징됩니다.

**해결**: 2-Phase 아키텍처 도입
- **Phase 1 (Quick Scan)**: 256px 저해상도 + pHash만으로 장면 분류 (360장 22초)
- **Phase 2 (On-Demand Deep)**: 사용자가 선택한 장면만 정밀 분석 (40장 29초)
- 2-way 동시성(concurrency)으로 feature extraction 병렬화
- 프리뷰 배치 생성으로 점진적 UI 업데이트

### 5. 스크롤 성능 — 가상화 없는 대량 썸네일

**문제**: 40개 이상 장면을 한 페이지에 표시할 때 드래그 시 버벅거림 발생.

**해결**: 
- Object URL 기반 프리뷰를 배치(4장씩) 생성하여 메모리 스파이크 방지
- 장면 카드에 대표 이미지만 표시하고, 상세 진입 시 나머지 로드
- `will-change` CSS 힌트와 `contain: layout` 으로 렌더링 최적화

---

## 설명 가능한 AI — Explainability

모든 판단에 대해 사용자가 이해할 수 있는 설명을 제공합니다:

- **추천 이유**: "표정이 밝고, 구도가 안정적이에요", "단체사진에서 모두 눈을 뜨고 있어요"
- **제외 이유**: "눈을 감은 사람이 있어요", "초점이 흐려요"
- **점수 breakdown**: Technical / Subject / Composition / Context / Uniqueness 각 축의 상세 점수

### 디버그 인스펙터

개발 과정에서 분석 결과를 검증하기 위한 전용 디버그 페이지를 구현했습니다:
- Photo 탭: 개별 사진의 모든 feature 값 조회
- Group 탭: 그룹 구성 및 분리 이유 확인
- Config 탭: 실시간 임계값 조정
- Failure 탭: 오분류 패턴 분석

---

## 구현된 config 기반 시스템

모든 임계값과 가중치가 하드코딩이 아닌 `analysisConfig.ts`의 설정 객체로 관리됩니다:

```typescript
interface ScoringConfig {
  hardFilters: {
    blurSevere: number;      // 최소 선명도
    eyeClosed: number;       // 눈 감김 임계값
    faceCutEnabled: boolean; // 얼굴 잘림 체크
    exposureExtreme: number; // 최소 노출
    // ...
  };
  scoring: {
    weights: { technical, subject, composition, context, uniqueness };
    // ...
  };
  grouping: {
    timeDiffThreshold: number;
    embedDistThreshold: number;
    // ...
  };
}
```

이를 통해 모델 변경이나 임계값 튜닝 시 코드 수정 없이 설정만 변경하면 됩니다.

---

## 사용자 피드백 구조

사용자의 저장/제외 행동을 `feedbackStore`에 기록하여 향후 모델 개선에 활용할 수 있는 구조를 마련했습니다:

- `photo_saved`: 사용자가 실제로 저장한 사진
- `photo_dismissed`: 사용자가 제외한 사진
- `group_viewed`: 그룹 상세 진입
- 각 이벤트에 해당 사진의 score, rank, 추천 여부 등 메타데이터 포함

---

## 프로젝트 구조

```
miniapp-web/
├── public/models/          # face-api.js 사전 학습 모델 (5종)
├── src/
│   ├── components/
│   │   └── Lightbox.tsx    # 이미지 뷰어 + 얼굴 오버레이 디버그
│   ├── pages/
│   │   ├── Home.tsx        # 홈 화면
│   │   ├── PhotoUpload.tsx # 사진 선택
│   │   ├── Processing.tsx  # Quick Scan 진행률
│   │   ├── SceneOverview.tsx # 장면 분류 결과
│   │   ├── DeepProcessing.tsx # 정밀 분석 진행률
│   │   ├── ResultSummary.tsx  # 결과 요약
│   │   ├── GroupDetail.tsx    # 그룹 상세
│   │   └── DebugInspector.tsx # 개발자 디버그
│   ├── lib/
│   │   ├── faceAnalyzer.ts     # face-api.js 래퍼 + MediaPipe 통합
│   │   ├── eyeStateAnalyzer.ts # MediaPipe 눈 감김 (크롭 방식)
│   │   ├── canvasAnalyzer.ts   # 화질·구도 분석
│   │   ├── bestShotRanker.ts   # 5축 스코어링 + Hard Filter
│   │   ├── sceneGrouper.ts     # 장면 클러스터링
│   │   ├── groupSplitter.ts    # 그룹 세분화
│   │   ├── mockAnalysis.ts     # 분석 파이프라인 오케스트레이터
│   │   ├── analysisConfig.ts   # 설정 기반 임계값 관리
│   │   ├── explainability.ts   # 판단 설명 생성
│   │   ├── photoTypes.ts       # 사진 유형 분류
│   │   ├── pHash.ts            # 지각적 해시 임베딩
│   │   ├── metadata.ts         # EXIF 메타데이터
│   │   ├── fileStore.ts        # 파일 관리
│   │   ├── previewQueue.ts     # 썸네일 생성
│   │   ├── feedbackStore.ts    # 사용자 피드백
│   │   └── perf.ts             # 성능 측정
│   ├── App.tsx
│   └── main.tsx
├── package.json
├── vite.config.ts
└── tsconfig.json
```

---

## 배운 점

1. **브라우저 ML의 현실적 한계**: WebGL 환경에서 모델의 동작이 네이티브와 다를 수 있음 (GPU delegate blendshape 버그, canvas 입력 인식 실패 등). 한 라이브러리에 의존하기보다 **여러 라이브러리의 장점을 조합**하는 하이브리드 접근이 효과적.

2. **로그 기반 디버깅의 중요성**: ML 파이프라인은 "왜 이 결과가 나왔는지"를 코드만 봐서는 알 수 없음. 각 단계별 상세 로깅(`[eyeState #N]`, `[EYE_CHECK]`, `[blink #N]`)과 시각적 디버그 오버레이(Lightbox 얼굴 박스)가 문제 진단에 결정적.

3. **임계값은 하드코딩하지 않기**: ML 기반 시스템에서 임계값은 반복적으로 조정됨. Config 객체로 분리하여 실험과 튜닝을 빠르게 반복할 수 있는 구조가 필수적.

4. **점진적 개선 전략**: 처음부터 완벽한 파이프라인을 설계하는 것은 불가능. 사용자 피드백 → 로그 분석 → 원인 진단 → 코드 수정의 반복 사이클을 빠르게 돌리는 것이 핵심.

5. **대규모 데이터의 UX**: 1,000장 이상의 사진을 처리할 때, 기술적으로 가능한 것과 사용자가 기다려줄 수 있는 것은 다른 문제. 2-Phase 분석으로 "빠른 분류 → 선택적 정밀 분석" 구조를 도입하여 체감 대기 시간을 줄임.
