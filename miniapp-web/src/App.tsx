import { Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import PhotoUpload from './pages/PhotoUpload';
import Processing from './pages/Processing';
import SceneOverview from './pages/SceneOverview';
import DeepProcessing from './pages/DeepProcessing';
import ResultSummary from './pages/ResultSummary';
import GroupDetail from './pages/GroupDetail';
import PremiumPage from './pages/PremiumPage';
import { lazy, Suspense } from 'react';

const DebugInspector = import.meta.env.DEV
  ? lazy(() => import('./pages/DebugInspector'))
  : null;

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/upload" element={<PhotoUpload />} />
      <Route path="/processing" element={<Processing />} />
      <Route path="/scenes" element={<SceneOverview />} />
      <Route path="/deep-analysis/:sceneId" element={<DeepProcessing />} />
      <Route path="/result" element={<ResultSummary />} />
      <Route path="/group/:id" element={<GroupDetail />} />
      <Route path="/premium" element={<PremiumPage />} />
      {DebugInspector && (
        <Route
          path="/debug"
          element={
            <Suspense fallback={<div style={{ padding: 40, textAlign: 'center' }}>Loading debug…</div>}>
              <DebugInspector />
            </Suspense>
          }
        />
      )}
    </Routes>
  );
}
