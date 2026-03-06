import { useEffect, useState, useCallback } from 'react';
import {
  Settings,
  Shield,
  Users,
  EyeOff,
  Eye,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { Card, CardHeader, CardTitle, Badge, Skeleton, EmptyState, Button } from '@/components/ui';
import { TEAM_LABELS } from '@/lib/constants';
import { cn } from '@/lib/utils';

/* ---------- Types ---------- */

interface AdminPipeline {
  id: number;
  name: string;
  team: 'azul' | 'amarela';
  paused: boolean;
}

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  teams: string[];
  allowed_funnels: Record<string, number[]>;
}

/* ---------- Helpers ---------- */

function groupByTeam(pipelines: AdminPipeline[]): Record<string, AdminPipeline[]> {
  const groups: Record<string, AdminPipeline[]> = {};
  for (const p of pipelines) {
    if (!groups[p.team]) groups[p.team] = [];
    groups[p.team].push(p);
  }
  return groups;
}

/* ---------- Toggle Switch ---------- */

function ToggleSwitch({
  checked,
  onChange,
  loading,
  label,
}: {
  checked: boolean;
  onChange: (val: boolean) => void;
  loading?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={loading}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
        checked ? 'bg-success' : 'bg-white/20'
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-lg transition-transform duration-200',
          checked ? 'translate-x-5' : 'translate-x-0.5'
        )}
      />
      {loading && (
        <Loader2 className="absolute -right-6 h-4 w-4 animate-spin text-muted" />
      )}
    </button>
  );
}

/* ---------- Pipeline Section (F02) ---------- */

function PipelineSection({
  pipelines,
  loading,
  onTogglePause,
}: {
  pipelines: AdminPipeline[];
  loading: boolean;
  onTogglePause: (pipelineId: number, paused: boolean) => Promise<void>;
}) {
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const grouped = groupByTeam(pipelines);

  const handleToggle = async (pipelineId: number, paused: boolean) => {
    setTogglingId(pipelineId);
    try {
      await onTogglePause(pipelineId, paused);
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-button bg-primary/10">
            <Settings className="h-5 w-5 text-primary" />
          </div>
          <CardTitle>Pipelines</CardTitle>
        </div>
        <Badge variant="accent">{pipelines.length} pipelines</Badge>
      </CardHeader>

      <div className="p-5">
        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-6 w-11 rounded-full" />
              </div>
            ))}
          </div>
        ) : pipelines.length === 0 ? (
          <EmptyState
            icon={Settings}
            title="Nenhum pipeline encontrado"
            description="Os pipelines do Kommo aparecerão aqui."
          />
        ) : (
          <div className="space-y-6">
            {Object.entries(grouped).map(([team, teamPipelines]) => (
              <div key={team}>
                <h4 className="mb-3 font-heading text-body-sm font-semibold uppercase tracking-wider text-muted">
                  {TEAM_LABELS[team] || team}
                </h4>
                <div className="space-y-2">
                  {teamPipelines.map((pipeline) => (
                    <div
                      key={pipeline.id}
                      className={cn(
                        'flex items-center justify-between rounded-button border border-glass-border px-4 py-3 transition-opacity duration-200',
                        pipeline.paused
                          ? 'bg-surface-secondary/50 opacity-50'
                          : 'bg-surface-secondary'
                      )}
                    >
                      <div className="flex items-center gap-3">
                        {pipeline.paused ? (
                          <EyeOff className="h-4 w-4 text-warning" />
                        ) : (
                          <Eye className="h-4 w-4 text-success" />
                        )}
                        <span className="text-body-md text-foreground">
                          {pipeline.name}
                        </span>
                        {pipeline.paused && (
                          <Badge variant="warning">Oculto</Badge>
                        )}
                      </div>
                      <ToggleSwitch
                        checked={!pipeline.paused}
                        loading={togglingId === pipeline.id}
                        label={`${pipeline.paused ? 'Mostrar' : 'Ocultar'} ${pipeline.name}`}
                        onChange={() =>
                          handleToggle(pipeline.id, !pipeline.paused)
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

/* ---------- User Funnel Panel ---------- */

function UserFunnelPanel({
  user,
  pipelines,
  onSave,
  onSaveTeams,
}: {
  user: AdminUser;
  pipelines: AdminPipeline[];
  onSave: (userId: string, team: string, funnelIds: number[]) => Promise<void>;
  onSaveTeams: (userId: string, teams: string[]) => Promise<void>;
}) {
  const grouped = groupByTeam(pipelines);
  const allTeamKeys = Object.keys(grouped);
  const [selected, setSelected] = useState<Record<string, Set<number>>>(() => {
    const init: Record<string, Set<number>> = {};
    for (const team of allTeamKeys) {
      const allowed = user.allowed_funnels?.[team] ?? [];
      init[team] = new Set(allowed);
    }
    return init;
  });
  const [userTeams, setUserTeams] = useState<Set<string>>(() => new Set(user.teams || []));
  const [saving, setSaving] = useState<string | null>(null);
  const [savedTeam, setSavedTeam] = useState<string | null>(null);
  const [savingTeams, setSavingTeams] = useState(false);
  const [savedTeams, setSavedTeams] = useState(false);

  const toggleTeam = (team: string) => {
    setUserTeams((prev) => {
      const next = new Set(prev);
      if (next.has(team)) {
        next.delete(team);
      } else {
        next.add(team);
      }
      return next;
    });
    setSavedTeams(false);
  };

  const handleSaveTeams = async () => {
    setSavingTeams(true);
    try {
      await onSaveTeams(user.id, Array.from(userTeams));
      setSavedTeams(true);
      setTimeout(() => setSavedTeams(false), 3000);
    } finally {
      setSavingTeams(false);
    }
  };

  const toggleFunnel = (team: string, pipelineId: number) => {
    setSelected((prev) => {
      const next = { ...prev };
      const s = new Set(prev[team] ?? []);
      if (s.has(pipelineId)) {
        s.delete(pipelineId);
      } else {
        s.add(pipelineId);
      }
      next[team] = s;
      return next;
    });
    setSavedTeam(null);
  };

  const selectAllTeam = (team: string) => {
    const teamPipelines = grouped[team] ?? [];
    setSelected((prev) => ({
      ...prev,
      [team]: new Set(teamPipelines.map((p) => p.id)),
    }));
    setSavedTeam(null);
  };

  const handleSave = async (team: string) => {
    setSaving(team);
    try {
      const funnelIds = Array.from(selected[team] ?? []);
      await onSave(user.id, team, funnelIds);
      setSavedTeam(team);
      setTimeout(() => setSavedTeam(null), 3000);
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="mt-2 rounded-button border border-glass-border bg-surface p-4 space-y-4">
      {/* Team access */}
      <div>
        <h5 className="font-heading text-body-sm font-semibold uppercase tracking-wider text-muted mb-2">
          Acesso a Times
        </h5>
        <div className="flex items-center gap-3 flex-wrap">
          {allTeamKeys.map((team) => (
            <label
              key={team}
              className={cn(
                'flex items-center gap-2 rounded-button px-3 py-2 text-body-sm cursor-pointer transition-colors',
                userTeams.has(team)
                  ? 'bg-primary/10 text-foreground font-medium'
                  : 'text-muted hover:bg-surface-secondary'
              )}
            >
              <input
                type="checkbox"
                checked={userTeams.has(team)}
                onChange={() => toggleTeam(team)}
                className="h-4 w-4 rounded border-glass-border bg-surface-secondary text-primary focus:ring-primary accent-primary"
              />
              {TEAM_LABELS[team] || team}
            </label>
          ))}
          <Button
            size="sm"
            onClick={handleSaveTeams}
            loading={savingTeams}
            disabled={savingTeams}
          >
            Salvar Times
          </Button>
          {savedTeams && (
            <span className="inline-flex items-center gap-1 rounded-badge bg-success/10 px-2 py-1 text-body-sm text-success">
              <Check className="h-3.5 w-3.5" />
              Salvo
            </span>
          )}
        </div>
      </div>

      {/* Funnel permissions per team */}
      {Object.entries(grouped).map(([team, teamPipelines]) => (
        <div key={team}>
          <div className="flex items-center justify-between mb-2">
            <h5 className="font-heading text-body-sm font-semibold uppercase tracking-wider text-muted">
              Funis — {TEAM_LABELS[team] || team}
            </h5>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => selectAllTeam(team)}
                className="text-body-sm text-primary hover:text-primary/80 font-medium transition-colors cursor-pointer"
              >
                Todos {TEAM_LABELS[team]?.split(' ')[1] || team}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {teamPipelines.map((pipeline) => {
              const isChecked = selected[team]?.has(pipeline.id) ?? false;
              return (
                <label
                  key={pipeline.id}
                  className={cn(
                    'flex items-center gap-2.5 rounded-button px-3 py-2 text-body-sm cursor-pointer transition-colors',
                    isChecked
                      ? 'bg-primary/10 text-foreground'
                      : 'text-muted hover:bg-surface-secondary'
                  )}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleFunnel(team, pipeline.id)}
                    className="h-4 w-4 rounded border-glass-border bg-surface-secondary text-primary focus:ring-primary accent-primary"
                  />
                  {pipeline.name}
                </label>
              );
            })}
          </div>

          <div className="mt-3 flex items-center gap-3">
            <Button
              size="sm"
              onClick={() => handleSave(team)}
              loading={saving === team}
              disabled={saving === team}
            >
              Salvar {TEAM_LABELS[team]?.split(' ')[1] || team}
            </Button>
            {savedTeam === team && (
              <span className="inline-flex items-center gap-1 rounded-badge bg-success/10 px-2 py-1 text-body-sm text-success">
                <Check className="h-3.5 w-3.5" />
                Salvo
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------- Users Section (F08) ---------- */

function UsersSection({
  users,
  pipelines,
  loading,
  onSaveFunnels,
  onSaveTeams,
}: {
  users: AdminUser[];
  pipelines: AdminPipeline[];
  loading: boolean;
  onSaveFunnels: (userId: string, team: string, funnelIds: number[]) => Promise<void>;
  onSaveTeams: (userId: string, teams: string[]) => Promise<void>;
}) {
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  const toggleExpand = (userId: string) => {
    setExpandedUserId((prev) => (prev === userId ? null : userId));
  };

  const roleBadge = (role: string) => {
    if (role === 'admin') return <Badge variant="accent">Admin</Badge>;
    return <Badge variant="default">Usuário</Badge>;
  };

  const statusBadge = (status: string) => {
    if (status === 'active' || status === 'approved')
      return <Badge variant="success">Ativo</Badge>;
    if (status === 'pending')
      return <Badge variant="warning">Pendente</Badge>;
    if (status === 'blocked' || status === 'rejected')
      return <Badge variant="danger">Bloqueado</Badge>;
    return <Badge variant="default">{status}</Badge>;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-button bg-primary/10">
            <Users className="h-5 w-5 text-primary" />
          </div>
          <CardTitle>Usuários e Funis</CardTitle>
        </div>
        <Badge variant="accent">{users.length} usuários</Badge>
      </CardHeader>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-surface-secondary text-muted text-body-sm">
              <th className="px-4 py-3 text-left font-medium w-8" />
              <th className="px-4 py-3 text-left font-medium">Nome</th>
              <th className="px-4 py-3 text-left font-medium">Email</th>
              <th className="px-4 py-3 text-left font-medium">Perfil</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-left font-medium">Times</th>
              <th className="px-4 py-3 text-center font-medium">Funis</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  <td className="border-t border-glass-border px-4 py-3">
                    <Skeleton className="h-4 w-4" />
                  </td>
                  <td className="border-t border-glass-border px-4 py-3">
                    <Skeleton className="h-5 w-32" />
                  </td>
                  <td className="border-t border-glass-border px-4 py-3">
                    <Skeleton className="h-5 w-44" />
                  </td>
                  <td className="border-t border-glass-border px-4 py-3">
                    <Skeleton className="h-5 w-16" />
                  </td>
                  <td className="border-t border-glass-border px-4 py-3">
                    <Skeleton className="h-5 w-16" />
                  </td>
                  <td className="border-t border-glass-border px-4 py-3">
                    <Skeleton className="h-5 w-24" />
                  </td>
                  <td className="border-t border-glass-border px-4 py-3">
                    <Skeleton className="mx-auto h-8 w-24" />
                  </td>
                </tr>
              ))
            ) : users.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="border-t border-glass-border px-4 py-8 text-center text-muted text-body-md"
                >
                  Nenhum usuário encontrado.
                </td>
              </tr>
            ) : (
              users.map((user) => {
                const isExpanded = expandedUserId === user.id;
                return (
                  <tr key={user.id} className="group">
                    <td
                      colSpan={7}
                      className="border-t border-glass-border p-0"
                    >
                      {/* Row content */}
                      <div className="flex items-center hover:bg-surface-secondary/50 transition-colors">
                        <div className="px-4 py-3 w-8">
                          <button
                            type="button"
                            onClick={() => toggleExpand(user.id)}
                            className="text-muted hover:text-foreground transition-colors cursor-pointer"
                            aria-label={isExpanded ? 'Fechar painel de funis' : 'Editar funis'}
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                        <div className="flex-1 px-4 py-3 text-body-md text-foreground font-medium">
                          {user.name}
                        </div>
                        <div className="flex-1 px-4 py-3 text-body-md text-muted">
                          {user.email}
                        </div>
                        <div className="px-4 py-3">{roleBadge(user.role)}</div>
                        <div className="px-4 py-3">
                          {statusBadge(user.status)}
                        </div>
                        <div className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {user.teams?.map((t) => (
                              <Badge key={t} variant="info">
                                {TEAM_LABELS[t]?.split(' ')[1] || t}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        <div className="px-4 py-3 text-center">
                          <Button
                            size="sm"
                            variant={isExpanded ? 'secondary' : 'ghost'}
                            onClick={() => toggleExpand(user.id)}
                          >
                            Editar Funis
                          </Button>
                        </div>
                      </div>

                      {/* Expanded panel */}
                      {isExpanded && (
                        <div className="px-4 pb-4">
                          <UserFunnelPanel
                            user={user}
                            pipelines={pipelines}
                            onSave={onSaveFunnels}
                            onSaveTeams={onSaveTeams}
                          />
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ---------- Admin Page ---------- */

export function AdminPage() {
  const user = useAuthStore((s) => s.user);
  const [pipelines, setPipelines] = useState<AdminPipeline[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loadingPipelines, setLoadingPipelines] = useState(true);
  const [loadingUsers, setLoadingUsers] = useState(true);

  const isAdmin = user?.role === 'admin';

  const fetchPipelines = useCallback(async () => {
    try {
      setLoadingPipelines(true);
      const res = await api.get<AdminPipeline[]>('/admin/pipelines');
      setPipelines(res.data);
    } catch (err) {
      console.error('[AdminPage] Erro ao carregar pipelines:', err);
    } finally {
      setLoadingPipelines(false);
    }
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      setLoadingUsers(true);
      const res = await api.get<AdminUser[]>('/admin/users');
      setUsers(res.data);
    } catch (err) {
      console.error('[AdminPage] Erro ao carregar usuários:', err);
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    fetchPipelines();
    fetchUsers();
  }, [isAdmin, fetchPipelines, fetchUsers]);

  const handleTogglePause = async (pipelineId: number, paused: boolean) => {
    try {
      await api.post('/admin/pipelines/pause', { pipelineId, paused });
      setPipelines((prev) =>
        prev.map((p) => (p.id === pipelineId ? { ...p, paused } : p))
      );
    } catch (err) {
      console.error('[AdminPage] Erro ao ocultar pipeline:', err);
    }
  };

  const handleSaveTeams = async (userId: string, teams: string[]) => {
    try {
      await api.patch(`/admin/users/${userId}/teams`, { teams });
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, teams } : u))
      );
    } catch (err) {
      console.error('[AdminPage] Erro ao salvar equipes:', err);
    }
  };

  const handleSaveFunnels = async (
    userId: string,
    team: string,
    allowedFunnels: number[]
  ) => {
    try {
      await api.patch(`/admin/users/${userId}/funnels`, {
        team,
        allowed_funnels: allowedFunnels,
      });
      // Update local state
      setUsers((prev) =>
        prev.map((u) =>
          u.id === userId
            ? {
                ...u,
                allowed_funnels: {
                  ...u.allowed_funnels,
                  [team]: allowedFunnels,
                },
              }
            : u
        )
      );
    } catch (err) {
      console.error('[AdminPage] Erro ao salvar funis:', err);
    }
  };

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <EmptyState
          icon={Shield}
          title="Acesso restrito a administradores"
          description="Você não tem permissão para acessar esta página. Entre em contato com um administrador."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div>
        <h1 className="font-heading text-heading-md">Administração</h1>
        <p className="mt-1 text-body-md text-muted">
          Gerencie pipelines, usuários e permissões de funis.
        </p>
      </div>

      {/* Section 1: Pipelines (F02) */}
      <PipelineSection
        pipelines={pipelines}
        loading={loadingPipelines}
        onTogglePause={handleTogglePause}
      />

      {/* Section 2: Users & Funnels (F08) */}
      <UsersSection
        users={users}
        pipelines={pipelines}
        loading={loadingUsers}
        onSaveFunnels={handleSaveFunnels}
        onSaveTeams={handleSaveTeams}
      />
    </div>
  );
}
