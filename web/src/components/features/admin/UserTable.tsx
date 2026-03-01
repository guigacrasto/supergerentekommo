import { useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, Badge, Button } from '@/components/ui';
import type { AdminUser } from '@/types';

interface UserTableProps {
  users: AdminUser[];
  onRefresh: () => void;
}

const STATUS_VARIANT: Record<string, 'warning' | 'success' | 'danger'> = {
  pending: 'warning',
  approved: 'success',
  denied: 'danger',
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pendente',
  approved: 'Aprovado',
  denied: 'Negado',
};

export function UserTable({ users, onRefresh }: UserTableProps) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [teamSelections, setTeamSelections] = useState<Record<string, string[]>>({});

  const toggleTeam = (userId: string, team: string) => {
    setTeamSelections((prev) => {
      const current = prev[userId] || [];
      return {
        ...prev,
        [userId]: current.includes(team)
          ? current.filter((t) => t !== team)
          : [...current, team],
      };
    });
  };

  const handleApprove = async (userId: string) => {
    const teams = teamSelections[userId] || [];
    if (teams.length === 0) {
      alert('Selecione pelo menos uma equipe.');
      return;
    }
    setLoadingId(userId);
    try {
      await api.post(`/admin/users/${userId}/approve`, { teams });
      onRefresh();
    } catch (err) {
      console.error('[UserTable] Erro ao aprovar:', err);
    } finally {
      setLoadingId(null);
    }
  };

  const handleDeny = async (userId: string) => {
    setLoadingId(userId);
    try {
      await api.post(`/admin/users/${userId}/deny`);
      onRefresh();
    } catch (err) {
      console.error('[UserTable] Erro ao negar:', err);
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-body-md">
          <thead>
            <tr className="border-b border-glass-border text-left">
              <th className="px-5 py-3 font-heading font-semibold">Nome</th>
              <th className="px-5 py-3 font-heading font-semibold">Email</th>
              <th className="px-5 py-3 font-heading font-semibold">Status</th>
              <th className="px-5 py-3 font-heading font-semibold">Acoes</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr
                key={user.id}
                className="border-b border-glass-border/50 last:border-0"
              >
                <td className="px-5 py-3">{user.name}</td>
                <td className="px-5 py-3 text-muted">{user.email}</td>
                <td className="px-5 py-3">
                  <Badge variant={STATUS_VARIANT[user.status]}>
                    {STATUS_LABEL[user.status]}
                  </Badge>
                </td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    {user.status === 'pending' && (
                      <>
                        <label className="flex items-center gap-1.5 text-body-sm cursor-pointer">
                          <input
                            type="checkbox"
                            checked={(teamSelections[user.id] || []).includes('azul')}
                            onChange={() => toggleTeam(user.id, 'azul')}
                            className="accent-primary"
                          />
                          Azul
                        </label>
                        <label className="flex items-center gap-1.5 text-body-sm cursor-pointer">
                          <input
                            type="checkbox"
                            checked={(teamSelections[user.id] || []).includes('amarela')}
                            onChange={() => toggleTeam(user.id, 'amarela')}
                            className="accent-primary"
                          />
                          Amarela
                        </label>
                        <Button
                          variant="success"
                          size="sm"
                          loading={loadingId === user.id}
                          onClick={() => handleApprove(user.id)}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          Aprovar
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          loading={loadingId === user.id}
                          onClick={() => handleDeny(user.id)}
                        >
                          <XCircle className="h-4 w-4" />
                          Negar
                        </Button>
                      </>
                    )}
                    {user.status === 'approved' && (
                      <Button
                        variant="danger"
                        size="sm"
                        loading={loadingId === user.id}
                        onClick={() => handleDeny(user.id)}
                      >
                        <XCircle className="h-4 w-4" />
                        Negar
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
