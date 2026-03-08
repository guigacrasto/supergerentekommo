import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { LoginPage } from '@/pages/LoginPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage';
import { ResetPasswordPage } from '@/pages/ResetPasswordPage';
import { ProfilePage } from '@/pages/ProfilePage';
import { DashboardPage } from '@/pages/DashboardPage';
import { ChatPage } from '@/pages/ChatPage';
import { AgentsPage } from '@/pages/AgentsPage';
import { AlertsPage } from '@/pages/AlertsPage';
import { InsightsPage } from '@/pages/InsightsPage';
import { DiarioPage } from '@/pages/DiarioPage';
import { TMFPage } from '@/pages/TMFPage';
import { LossReasonsPage } from '@/pages/LossReasonsPage';
import { RendaPage } from '@/pages/RendaPage';
import { ProfissaoPage } from '@/pages/ProfissaoPage';
import { DDDPage } from '@/pages/DDDPage';
import { TeamDashboardPage } from '@/pages/TeamDashboardPage';
import { AdminPage } from '@/pages/AdminPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AuthLayout />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
        </Route>
        <Route element={<AppShell />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/diario" element={<DiarioPage />} />
          <Route path="/tmf" element={<TMFPage />} />
          <Route path="/motivos-perda" element={<LossReasonsPage />} />
          <Route path="/renda" element={<RendaPage />} />
          <Route path="/profissao" element={<ProfissaoPage />} />
          <Route path="/ddd" element={<DDDPage />} />
          <Route path="/team/:team" element={<TeamDashboardPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/alerts" element={<AlertsPage />} />
          <Route path="/insights" element={<InsightsPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/profile" element={<ProfilePage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
