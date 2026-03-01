import { useState } from 'react';
import { ExternalLink, KeyRound } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, Badge, Button, Input } from '@/components/ui';
import { TEAM_LABELS } from '@/lib/constants';
import { formatDateTime } from '@/lib/utils';
import type { Team, TokenStatus } from '@/types';

interface TokenPanelProps {
  tokenStatus: Record<Team, TokenStatus> | null;
  onRefresh: () => void;
}

const TEAMS: Team[] = ['azul', 'amarela'];

export function TokenPanel({ tokenStatus, onRefresh }: TokenPanelProps) {
  const [codes, setCodes] = useState<Record<string, string>>({ azul: '', amarela: '' });
  const [loadingTeam, setLoadingTeam] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, { type: 'success' | 'error'; text: string }>>({});

  const handleAuthorize = async (team: Team) => {
    try {
      const { data } = await api.get<{ url: string }>(`/oauth/start?team=${team}`);
      window.open(data.url, '_blank');
    } catch (err) {
      console.error('[TokenPanel] Erro ao iniciar OAuth:', err);
      setMessages((prev) => ({
        ...prev,
        [team]: { type: 'error', text: 'Erro ao iniciar autorizacao.' },
      }));
    }
  };

  const handleExchange = async (team: Team) => {
    const code = codes[team]?.trim();
    if (!code) return;

    setLoadingTeam(team);
    setMessages((prev) => ({ ...prev, [team]: undefined! }));

    try {
      await api.post(`/oauth/exchange?team=${team}`, { code });
      setMessages((prev) => ({
        ...prev,
        [team]: { type: 'success', text: 'Token obtido com sucesso!' },
      }));
      setCodes((prev) => ({ ...prev, [team]: '' }));
      onRefresh();
    } catch (err) {
      console.error('[TokenPanel] Erro ao trocar codigo:', err);
      setMessages((prev) => ({
        ...prev,
        [team]: { type: 'error', text: 'Erro ao trocar codigo. Verifique e tente novamente.' },
      }));
    } finally {
      setLoadingTeam(null);
    }
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {TEAMS.map((team) => {
        const status = tokenStatus?.[team];
        const msg = messages[team];

        return (
          <Card key={team} className="p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h4 className="font-heading text-heading-sm flex items-center gap-2">
                <KeyRound className="h-5 w-5 text-primary" />
                {TEAM_LABELS[team]}
              </h4>
            </div>

            {/* Status */}
            <div className="space-y-2 text-body-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted">Refresh Token:</span>
                <Badge variant={status?.hasRefreshToken ? 'success' : 'danger'}>
                  {status?.hasRefreshToken ? 'Presente' : 'Ausente'}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted">Expiracao:</span>
                <span>
                  {status?.expiresAt
                    ? formatDateTime(status.expiresAt)
                    : 'N/A'}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-3 pt-2 border-t border-glass-border">
              <Button
                variant="secondary"
                size="sm"
                className="w-full"
                onClick={() => handleAuthorize(team)}
              >
                <ExternalLink className="h-4 w-4" />
                Autorizar Kommo
              </Button>

              <div className="flex gap-2">
                <Input
                  placeholder="Codigo de autorizacao"
                  value={codes[team]}
                  onChange={(e) =>
                    setCodes((prev) => ({ ...prev, [team]: e.target.value }))
                  }
                  className="flex-1"
                />
                <Button
                  size="sm"
                  loading={loadingTeam === team}
                  onClick={() => handleExchange(team)}
                  disabled={!codes[team]?.trim()}
                >
                  Confirmar
                </Button>
              </div>

              {msg && (
                <div
                  className={`rounded-button px-3 py-2 text-body-sm ${
                    msg.type === 'success'
                      ? 'bg-success-bg text-success'
                      : 'bg-danger/10 text-danger'
                  }`}
                >
                  {msg.text}
                </div>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
