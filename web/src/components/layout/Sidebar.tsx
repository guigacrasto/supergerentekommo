import { useState, useEffect } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  PieChart,
  CalendarDays,
  Clock,
  XCircle,
  DollarSign,
  Briefcase,
  Phone,
  MessageSquare,
  Headset,
  AlertTriangle,
  Brain,
  Settings,
  LogOut,
  ChevronRight,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  X,
  User,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { useSidebarStore } from '@/stores/sidebarStore';
import { usePipelines } from '@/hooks/usePipelines';
import { TEAM_LABELS, APP_NAME } from '@/lib/constants';
import { stripFunilPrefix } from '@/lib/utils';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: PieChart },
  { to: '/diario', label: 'Diário', icon: CalendarDays },
  { to: '/tmf', label: 'TMF', icon: Clock },
  { to: '/motivos-perda', label: 'Motivos Perda', icon: XCircle },
  { to: '/renda', label: 'Renda', icon: DollarSign },
  { to: '/profissao', label: 'Profissão', icon: Briefcase },
  { to: '/ddd', label: 'DDD', icon: Phone },
  { to: '/chat', label: 'Chat IA', icon: MessageSquare },
  { to: '/agents', label: 'Agentes', icon: Headset },
  { to: '/alerts', label: 'Alertas', icon: AlertTriangle },
] as const;

const ADMIN_NAV_ITEMS = [
  { to: '/insights', label: 'Insights', icon: Brain },
] as const;

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { collapsed, toggle } = useSidebarStore();
  const { byTeam } = usePipelines();
  const navigate = useNavigate();
  const [expandedTeams, setExpandedTeams] = useState<Record<string, boolean>>({});

  // On mobile, collapsed is always false (full sidebar)
  const isMobile = onNavigate !== undefined;
  const isCollapsed = isMobile ? false : collapsed;

  const toggleTeam = (team: string) =>
    setExpandedTeams((prev) => ({ ...prev, [team]: !prev[team] }));

  const handleLogout = () => {
    logout();
    navigate('/login');
    onNavigate?.();
  };

  const handleNavClick = () => {
    onNavigate?.();
  };

  return (
    <>
      {/* Logo + collapse toggle */}
      <div className={cn('flex items-center px-5 py-5', isCollapsed ? 'justify-center' : 'gap-3')}>
        <img src="/logo.svg" alt={APP_NAME} className="h-9 w-9 shrink-0 rounded-button" />
        {!isCollapsed && (
          <>
            <span className="font-heading text-heading-sm text-white truncate flex-1">
              {APP_NAME}
            </span>
            {!isMobile && (
              <button
                onClick={toggle}
                title="Recolher menu"
                className="flex items-center justify-center rounded-button p-1.5 text-white/50 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
              >
                <ChevronsLeft className="h-4 w-4" />
              </button>
            )}
          </>
        )}
        {isCollapsed && !isMobile && (
          <button
            onClick={toggle}
            title="Expandir menu"
            className="absolute left-[68px] top-6 -translate-x-1/2 flex h-6 w-6 items-center justify-center rounded-full bg-sidebar border border-white/10 text-white/70 hover:text-white transition-colors cursor-pointer z-10"
          >
            <ChevronsRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-2">
        <ul className="space-y-1">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={to === '/'}
                onClick={handleNavClick}
                title={isCollapsed ? label : undefined}
                className={({ isActive }) =>
                  cn(
                    'flex items-center rounded-button px-3 py-2.5 text-body-md font-medium transition-colors duration-150',
                    isCollapsed ? 'justify-center' : 'gap-3',
                    isActive
                      ? 'border-l-2 border-primary bg-primary/20 text-white'
                      : 'text-white/70 hover:bg-white/10 hover:text-white'
                  )
                }
              >
                <Icon className="h-5 w-5 shrink-0" />
                {!isCollapsed && label}
              </NavLink>
            </li>
          ))}

          {/* Admin-only nav items */}
          {user?.role === 'admin' && ADMIN_NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                onClick={handleNavClick}
                title={isCollapsed ? label : undefined}
                className={({ isActive }) =>
                  cn(
                    'flex items-center rounded-button px-3 py-2.5 text-body-md font-medium transition-colors duration-150',
                    isCollapsed ? 'justify-center' : 'gap-3',
                    isActive
                      ? 'border-l-2 border-primary bg-primary/20 text-white'
                      : 'text-white/70 hover:bg-white/10 hover:text-white'
                  )
                }
              >
                <Icon className="h-5 w-5 shrink-0" />
                {!isCollapsed && label}
              </NavLink>
            </li>
          ))}

          {/* Admin link — only for admins */}
          {user?.role === 'admin' && (
            <li>
              <NavLink
                to="/admin"
                onClick={handleNavClick}
                title={isCollapsed ? 'Admin' : undefined}
                className={({ isActive }) =>
                  cn(
                    'flex items-center rounded-button px-3 py-2.5 text-body-md font-medium transition-colors duration-150',
                    isCollapsed ? 'justify-center' : 'gap-3',
                    isActive
                      ? 'border-l-2 border-primary bg-primary/20 text-white'
                      : 'text-white/70 hover:bg-white/10 hover:text-white'
                  )
                }
              >
                <Settings className="h-5 w-5 shrink-0" />
                {!isCollapsed && 'Admin'}
              </NavLink>
            </li>
          )}
        </ul>

        {/* Team accordion sections — hidden when collapsed, admin only */}
        {!isCollapsed && user?.role === 'admin' && (
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
                      <li>
                        <button
                          type="button"
                          onClick={() => {
                            navigate(`/team/${team}`);
                            onNavigate?.();
                          }}
                          className="block w-full text-left rounded-button px-3 py-1.5 text-body-sm text-primary font-heading font-semibold hover:bg-white/10 transition-colors cursor-pointer"
                        >
                          Todos
                        </button>
                      </li>
                      {teamPipelines.map((p) => (
                        <li key={p.id}>
                          <button
                            type="button"
                            onClick={() => {
                              navigate(`/team/${team}?pipeline=${encodeURIComponent(stripFunilPrefix(p.name))}`);
                              onNavigate?.();
                            }}
                            className="block w-full text-left rounded-button px-3 py-1.5 text-body-sm text-white/60 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
                          >
                            {stripFunilPrefix(p.name)}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </nav>

      {/* Footer */}
      <div className="border-t border-white/10 px-3 py-3 space-y-1">
        <NavLink
          to="/profile"
          onClick={handleNavClick}
          title={isCollapsed ? 'Perfil' : undefined}
          className={({ isActive }) =>
            cn(
              'flex w-full items-center rounded-button px-3 py-2 text-body-md transition-colors cursor-pointer',
              isCollapsed ? 'justify-center' : 'gap-3',
              isActive
                ? 'border-l-2 border-primary bg-primary/20 text-white'
                : 'text-white/70 hover:bg-white/10 hover:text-white'
            )
          }
        >
          <User className="h-5 w-5 shrink-0" />
          {!isCollapsed && 'Perfil'}
        </NavLink>
        <button
          onClick={handleLogout}
          title={isCollapsed ? 'Sair' : undefined}
          className={cn(
            'flex w-full items-center rounded-button px-3 py-2 text-body-md text-white/70 hover:bg-white/10 hover:text-white transition-colors cursor-pointer',
            isCollapsed ? 'justify-center' : 'gap-3'
          )}
        >
          <LogOut className="h-5 w-5 shrink-0" />
          {!isCollapsed && 'Sair'}
        </button>
      </div>
    </>
  );
}

export function Sidebar() {
  const { collapsed, mobileOpen, closeMobile } = useSidebarStore();
  const location = useLocation();

  // Close mobile sidebar on route change
  useEffect(() => {
    closeMobile();
  }, [location.pathname, closeMobile]);

  return (
    <>
      {/* Desktop sidebar — hidden on mobile */}
      <aside
        className={cn(
          'relative hidden md:flex h-screen flex-col bg-sidebar text-white transition-[width] duration-200 ease-out',
          collapsed ? 'w-[68px]' : 'w-[260px]'
        )}
      >
        <SidebarContent />
      </aside>

      {/* Mobile overlay + drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
            onClick={closeMobile}
          />
          {/* Drawer */}
          <aside className="relative flex h-full w-[280px] flex-col bg-sidebar text-white shadow-2xl animate-slide-in-left">
            {/* Close button */}
            <button
              onClick={closeMobile}
              className="absolute top-4 right-4 flex items-center justify-center rounded-button p-1.5 text-white/50 hover:bg-white/10 hover:text-white transition-colors cursor-pointer z-10"
              aria-label="Fechar menu"
            >
              <X className="h-5 w-5" />
            </button>
            <SidebarContent onNavigate={closeMobile} />
          </aside>
        </div>
      )}
    </>
  );
}
