import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { AuthProvider } from './auth/AuthProvider.tsx'
import { RequireAuth } from './components/RequireAuth.tsx'
import { Shell } from './components/Shell.tsx'
import { supabase } from './lib/supabase.ts'
import { AdminPage } from './pages/AdminPage.tsx'
import { FeedbackPage } from './pages/FeedbackPage.tsx'
import { HomePage } from './pages/HomePage.tsx'
import { LoginPage } from './pages/LoginPage.tsx'
import { SetupNotice } from './pages/SetupNotice.tsx'

export default function App() {
  if (!supabase) return <SetupNotice />

  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireAuth />}>
            <Route element={<Shell />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/feedback" element={<FeedbackPage />} />
              <Route path="/admin" element={<AdminPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
