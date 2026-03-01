import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  PieChart,
  MessageSquare,
  BarChart3,
  AlertTriangle,
  LogOut,
  Settings,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { usePipelines } from '@/hooks/usePipelines';
import { TEAM_LABELS, APP_SHORT_NAME, APP_NAME } from '@/lib/constants';
import { stripFunilPrefix } from '@/lib/utils';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: PieChart },
  { to: '/chat', label: 'Chat IA', icon: MessageSquare },
  { to: '/agents', label: 'Agentes', icon: BarChart3 },
  { to: '/alerts', label: 'Alertas', icon: AlertTriangle },
] as const;

export function Sidebar() {
  const { user, logout } = useAuthStore();
  const { byTeam } = usePipelines();
  const navigate = useNavigate();
  const [expandedTeams, setExpandedTeams] = useState<Record<string, boolean>>({});

  const toggleTeam = (team: string) =>
    setExpandedTeams((prev) => ({ ...prev, [team]: !prev[team] }));

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <aside className="flex h-screen w-[260px] flex-col bg-sidebar text-white">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-button bg-gradient-to-br from-primary to-accent-blue font-heading text-heading-sm text-white">
          {APP_SHORT_NAME}
        </div>
        <span className="font-heading text-heading-sm text-white">
          {APP_NAME}
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-2">
        <ul className="space-y-1">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-button px-3 py-2.5 text-body-md font-medium transition-colors duration-150',
                    isActive
                      ? 'border-l-2 border-primary bg-primary/20 text-white'
                      : 'text-white/70 hover:bg-white/10 hover:text-white'
                  )
                }
              >
                <Icon className="h-5 w-5 shrink-0" />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>

        {/* Team accordion sections */}
        <div className="mt-6 space-y-2">
          {(['azul', 'amarela'] as const).map((team) => {
            const teamPipelines = byTeam(team);
            if (teamPipelines.length === 0) return null;
            const expanded = !!expandedTeams[team];

            return (
              <div key={team}>
                <button
                  onClick={() => toggleTeam(team)}
                  className="flex w-full items-center gap-2 rounded-button px-3 py-2 text-body-sm font-heading font-semibold uppercase tracking-wider text-white/50 hover:text-white/80 transition-colors cursor-pointer"
                >
                  {expanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  {TEAM_LABELS[team] || team}
                </button>
                {expanded && (
                  <ul className="ml-4 space-y-0.5">
                    {teamPipelines.map((p) => (
                      <li key={p.id}>
                        <span className="block rounded-button px-3 py-1.5 text-body-sm text-white/60">
                          {stripFunilPrefix(p.name)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </nav>

      {/* Footer */}
      <div className="border-t border-white/10 px-3 py-3 space-y-1">
        {/* Admin link */}
        {user?.role === 'admin' && (
          <NavLink
            to="/admin"
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-button px-3 py-2 text-body-md transition-colors',
                isActive
                  ? 'bg-primary/20 text-white'
                  : 'text-white/70 hover:bg-white/10 hover:text-white'
              )
            }
          >
            <Settings className="h-5 w-5" />
            Admin
          </NavLink>
        )}

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-button px-3 py-2 text-body-md text-white/70 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
        >
          <LogOut className="h-5 w-5" />
          Sair
        </button>
      </div>
    </aside>
  );
}
