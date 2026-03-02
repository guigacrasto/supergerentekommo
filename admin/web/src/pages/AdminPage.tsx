import { useEffect, useState, useCallback } from 'react';
import { Users, Bot, KeyRound, BarChart3, Plus, RefreshCw, Eye } from 'lucide-react';
import { api } from '@/lib/api';
import { PageSpinner, EmptyState, Chip, Button } from '@/components/ui';
import { UserTable } from '@/components/features/admin/UserTable';
import { MentorList } from '@/components/features/admin/MentorList';
import { MentorForm } from '@/components/features/admin/MentorForm';
import { TokenPanel } from '@/components/features/admin/TokenPanel';
import { TokenUsage } from '@/components/features/admin/TokenUsage';
import { PipelineVisibility } from '@/components/features/admin/PipelineVisibility';
import type {
  AdminUser,
  Mentor,
  MentorFormData,
  TokenStatus,
  TokenUsage as TokenUsageType,
  Team,
} from '@/types';

type AdminTab = 'usuarios' | 'mentores' | 'tokens' | 'uso' | 'visibilidade';

const TABS: { key: AdminTab; label: string; icon: typeof Users }[] = [
  { key: 'usuarios', label: 'Usuarios', icon: Users },
  { key: 'mentores', label: 'Mentores', icon: Bot },
  { key: 'tokens', label: 'Tokens', icon: KeyRound },
  { key: 'uso', label: 'Uso IA', icon: BarChart3 },
  { key: 'visibilidade', label: 'Visibilidade', icon: Eye },
];

export function AdminPage() {
  const [activeTab, setActiveTab] = useState<AdminTab>('usuarios');
  const [loading, setLoading] = useState(true);

  // Data
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [mentors, setMentors] = useState<Mentor[]>([]);
  const [tokenStatus, setTokenStatus] = useState<Record<Team, TokenStatus> | null>(null);
  const [tokenUsage, setTokenUsage] = useState<TokenUsageType[]>([]);

  const [refreshingUsers, setRefreshingUsers] = useState(false);

  // Mentor form state
  const [showMentorForm, setShowMentorForm] = useState(false);
  const [editingMentor, setEditingMentor] = useState<MentorFormData | undefined>();

  const fetchUsers = useCallback(async () => {
    try {
      const res = await api.get<AdminUser[]>('/admin/users');
      setUsers(res.data);
    } catch (err) {
      console.error('[AdminPage] Erro ao carregar usuarios:', err);
    }
  }, []);

  const fetchMentors = useCallback(async () => {
    try {
      const res = await api.get<Mentor[]>('/admin/mentors');
      setMentors(res.data);
    } catch (err) {
      console.error('[AdminPage] Erro ao carregar mentores:', err);
    }
  }, []);

  const fetchTokenStatus = useCallback(async () => {
    try {
      const res = await api.get<Record<Team, TokenStatus>>('/oauth/status');
      setTokenStatus(res.data);
    } catch (err) {
      console.error('[AdminPage] Erro ao carregar status tokens:', err);
    }
  }, []);

  const fetchTokenUsage = useCallback(async () => {
    try {
      const res = await api.get<TokenUsageType[]>('/admin/tokens');
      setTokenUsage(res.data);
    } catch (err) {
      console.error('[AdminPage] Erro ao carregar uso de tokens:', err);
    }
  }, []);

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      await Promise.all([
        fetchUsers(),
        fetchMentors(),
        fetchTokenStatus(),
        fetchTokenUsage(),
      ]);
      setLoading(false);
    };

    fetchAll();
  }, [fetchUsers, fetchMentors, fetchTokenStatus, fetchTokenUsage]);

  const handleRefreshUsers = async () => {
    setRefreshingUsers(true);
    await fetchUsers();
    setRefreshingUsers(false);
  };

  const handleEditMentor = (mentor: Mentor) => {
    setEditingMentor({
      id: mentor.id,
      name: mentor.name,
      description: mentor.description,
      system_prompt: mentor.system_prompt,
      methodology_text: mentor.methodology_text || '',
      is_active: mentor.is_active,
    });
    setShowMentorForm(true);
  };

  const handleDeleteMentor = async (id: string) => {
    try {
      await api.delete(`/admin/mentors/${id}`);
      fetchMentors();
    } catch (err) {
      console.error('[AdminPage] Erro ao excluir mentor:', err);
    }
  };

  const handleMentorSave = () => {
    setShowMentorForm(false);
    setEditingMentor(undefined);
    fetchMentors();
  };

  const handleMentorCancel = () => {
    setShowMentorForm(false);
    setEditingMentor(undefined);
  };

  if (loading) {
    return <PageSpinner />;
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-heading text-heading-lg">Administracao</h1>

      {/* Tab bar */}
      <div className="flex flex-wrap gap-2">
        {TABS.map(({ key, label, icon: Icon }) => (
          <Chip
            key={key}
            active={activeTab === key}
            onClick={() => setActiveTab(key)}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Chip>
        ))}
      </div>

      {/* Usuarios */}
      {activeTab === 'usuarios' && (
        <>
          <div className="flex justify-end">
            <Button
              variant="secondary"
              size="sm"
              loading={refreshingUsers}
              onClick={handleRefreshUsers}
            >
              <RefreshCw className="h-4 w-4" />
              Atualizar
            </Button>
          </div>
          {users.length === 0 ? (
            <EmptyState
              icon={Users}
              title="Nenhum usuario encontrado"
              description="Nao ha usuarios cadastrados no sistema."
            />
          ) : (
            <UserTable users={users} onRefresh={fetchUsers} />
          )}
        </>
      )}

      {/* Mentores */}
      {activeTab === 'mentores' && (
        <>
          {showMentorForm ? (
            <MentorForm
              mentor={editingMentor}
              onSave={handleMentorSave}
              onCancel={handleMentorCancel}
            />
          ) : (
            <>
              <div className="flex justify-end">
                <Button onClick={() => setShowMentorForm(true)}>
                  <Plus className="h-4 w-4" />
                  Novo Mentor
                </Button>
              </div>

              {mentors.length === 0 ? (
                <EmptyState
                  icon={Bot}
                  title="Nenhum mentor cadastrado"
                  description="Crie um mentor para comecar a usar o chat com IA."
                />
              ) : (
                <MentorList
                  mentors={mentors}
                  onEdit={handleEditMentor}
                  onDelete={handleDeleteMentor}
                />
              )}
            </>
          )}
        </>
      )}

      {/* Tokens */}
      {activeTab === 'tokens' && (
        <TokenPanel tokenStatus={tokenStatus} onRefresh={fetchTokenStatus} />
      )}

      {/* Uso IA */}
      {activeTab === 'uso' && (
        <>
          {tokenUsage.length === 0 ? (
            <EmptyState
              icon={BarChart3}
              title="Nenhum dado de uso"
              description="Ainda nao ha registros de uso de tokens."
            />
          ) : (
            <TokenUsage data={tokenUsage} />
          )}
        </>
      )}

      {/* Visibilidade */}
      {activeTab === 'visibilidade' && <PipelineVisibility />}
    </div>
  );
}
