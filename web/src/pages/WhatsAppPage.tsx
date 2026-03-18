import { useEffect, useState, useCallback } from 'react';
import { MessageCircle, Plus, Trash2, ArrowRight, RefreshCw, Pencil, Check, X } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, Badge, Skeleton, EmptyState, Button } from '@/components/ui';
import { cn } from '@/lib/utils';

interface KommoUser {
  id: number;
  name: string;
  email: string;
}

interface WhatsAppNumber {
  id: string;
  user_id: string;
  team: string;
  phone: string;
  kommo_source_name: string | null;
  kommo_user_id: number | null;
  active: boolean;
  created_at: string;
}

interface RoutingLog {
  id: string;
  team: string;
  lead_id: number;
  lead_name: string;
  from_user_id: number;
  to_user_id: number;
  to_user_name: string;
  phone_matched: string;
  source_name: string;
  routed_at: string;
}

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 13) {
    return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  return phone;
}

function formatDateBR(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function WhatsAppPage() {
  const [numbers, setNumbers] = useState<WhatsAppNumber[]>([]);
  const [logs, setLogs] = useState<RoutingLog[]>([]);
  const [kommoUsersAzul, setKommoUsersAzul] = useState<KommoUser[]>([]);
  const [kommoUsersAmarela, setKommoUsersAmarela] = useState<KommoUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);

  const [phone, setPhone] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [kommoUserId, setKommoUserId] = useState('');
  const [team, setTeam] = useState('azul');
  const [filterAgent, setFilterAgent] = useState('todos');

  // Editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAgent, setEditAgent] = useState('');
  const [editSource, setEditSource] = useState('');

  const getKommoUsers = (teamKey: string) =>
    teamKey === 'amarela' ? kommoUsersAmarela : kommoUsersAzul;

  const allKommoUsers = [...kommoUsersAzul, ...kommoUsersAmarela];

  const fetchAllKommoUsers = useCallback(async () => {
    try {
      setLoadingUsers(true);
      const [azulRes, amarelaRes] = await Promise.allSettled([
        api.get<{ users: KommoUser[] }>('/whatsapp/kommo-users?team=azul'),
        api.get<{ users: KommoUser[] }>('/whatsapp/kommo-users?team=amarela'),
      ]);
      if (azulRes.status === 'fulfilled') setKommoUsersAzul(azulRes.value.data.users);
      if (amarelaRes.status === 'fulfilled') setKommoUsersAmarela(amarelaRes.value.data.users);
    } catch (err) {
      console.error('[WhatsAppPage] Erro ao buscar agentes:', err);
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [numRes, logRes] = await Promise.all([
        api.get<{ numbers: WhatsAppNumber[] }>('/whatsapp/numbers'),
        api.get<{ logs: RoutingLog[] }>('/whatsapp/logs'),
      ]);
      setNumbers(numRes.data.numbers);
      setLogs(logRes.data.logs);
    } catch (err) {
      console.error('[WhatsAppPage] Erro:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    fetchAllKommoUsers();
  }, [fetchData, fetchAllKommoUsers]);

  const handleAdd = async () => {
    if (!phone.trim()) return;
    setSaving(true);
    try {
      await api.post('/whatsapp/numbers', {
        phone: phone.trim(),
        team,
        kommo_source_name: sourceName.trim() || null,
        kommo_user_id: kommoUserId ? Number(kommoUserId) : null,
      });
      setPhone('');
      setSourceName('');
      setKommoUserId('');
      fetchData();
    } catch (err) {
      console.error('[WhatsAppPage] Erro ao cadastrar:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/whatsapp/numbers/${id}`);
      fetchData();
    } catch (err) {
      console.error('[WhatsAppPage] Erro ao remover:', err);
    }
  };

  const handleToggleActive = async (n: WhatsAppNumber) => {
    try {
      await api.patch(`/whatsapp/numbers/${n.id}`, { active: !n.active });
      fetchData();
    } catch (err) {
      console.error('[WhatsAppPage] Erro ao alterar status:', err);
    }
  };

  const startEditing = (n: WhatsAppNumber) => {
    setEditingId(n.id);
    setEditAgent(n.kommo_user_id ? String(n.kommo_user_id) : '');
    setEditSource(n.kommo_source_name || '');
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditAgent('');
    setEditSource('');
  };

  const saveEditing = async (n: WhatsAppNumber) => {
    try {
      await api.patch(`/whatsapp/numbers/${n.id}`, {
        kommo_user_id: editAgent ? Number(editAgent) : null,
        kommo_source_name: editSource.trim() || null,
      });
      setEditingId(null);
      fetchData();
    } catch (err) {
      console.error('[WhatsAppPage] Erro ao editar:', err);
    }
  };

  const getAgentName = (kommoId: number | null) => {
    if (!kommoId) return '\u2014';
    const user = allKommoUsers.find((u) => u.id === kommoId);
    return user ? user.name : `#${kommoId}`;
  };

  const filteredNumbers = filterAgent === 'todos'
    ? numbers
    : numbers.filter((n) => String(n.kommo_user_id) === filterAgent);

  const inputClass = 'rounded-button border border-glass-border bg-surface-secondary px-3 py-2 text-body-sm text-foreground outline-none focus:border-primary placeholder:text-muted/50';

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <MessageCircle className="h-7 w-7 text-success" />
            <h1 className="font-heading text-heading-md">WhatsApp Routing</h1>
          </div>
          <p className="mt-1 text-body-md text-muted">
            Cadastre números WhatsApp pessoais para redirecionar leads automaticamente ao agente correto
          </p>
        </div>
        <Button onClick={fetchData} variant="ghost" size="sm" loading={loading}>
          <RefreshCw className="h-4 w-4 mr-1.5" />
          Atualizar
        </Button>
      </div>

      {/* Add Number Card */}
      <Card className="!p-5">
        <h2 className="font-heading text-heading-sm mb-4">Cadastrar Número</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-body-sm text-muted">Telefone *</label>
            <input
              type="text"
              placeholder="+5511999999999"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={cn(inputClass, 'w-48')}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-body-sm text-muted">Nome da Fonte (Kommo)</label>
            <input
              type="text"
              placeholder="WhatsApp - João"
              value={sourceName}
              onChange={(e) => setSourceName(e.target.value)}
              className={cn(inputClass, 'w-56')}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-body-sm text-muted">Time</label>
            <select
              value={team}
              onChange={(e) => {
                setTeam(e.target.value);
                setKommoUserId('');
              }}
              className={cn(inputClass, 'w-32')}
            >
              <option value="azul">Azul</option>
              <option value="amarela">Amarela</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-body-sm text-muted">Agente Kommo *</label>
            <select
              value={kommoUserId}
              onChange={(e) => setKommoUserId(e.target.value)}
              disabled={loadingUsers}
              className={cn(inputClass, 'w-56')}
            >
              <option value="">{loadingUsers ? 'Carregando...' : 'Selecione o agente'}</option>
              {getKommoUsers(team).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} {u.email ? `(${u.email})` : ''}
                </option>
              ))}
            </select>
          </div>
          <Button onClick={handleAdd} loading={saving} disabled={!phone.trim() || !kommoUserId}>
            <Plus className="h-4 w-4 mr-1.5" />
            Cadastrar
          </Button>
        </div>
      </Card>

      {/* Filter bar */}
      {numbers.length > 0 && (
        <div className="flex items-center gap-3">
          <label className="text-body-sm text-muted">Filtrar por agente:</label>
          <select
            value={filterAgent}
            onChange={(e) => setFilterAgent(e.target.value)}
            className={cn(inputClass, 'w-56')}
          >
            <option value="todos">Todos</option>
            {[...new Map(numbers.filter((n) => n.kommo_user_id).map((n) => [n.kommo_user_id, n])).values()].map((n) => (
              <option key={n.kommo_user_id} value={String(n.kommo_user_id)}>
                {getAgentName(n.kommo_user_id)}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Numbers Table */}
      {loading ? (
        <div className="rounded-card border border-glass-border bg-surface p-4 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : numbers.length === 0 ? (
        <EmptyState
          icon={MessageCircle}
          title="Nenhum número cadastrado"
          description="Cadastre um número WhatsApp acima para começar o roteamento automático."
        />
      ) : (
        <div className="rounded-card border border-glass-border bg-surface overflow-x-auto">
          <table className="w-full text-left text-body-sm">
            <thead>
              <tr className="border-b border-glass-border text-muted">
                <th className="px-4 py-3 font-medium">Telefone</th>
                <th className="px-4 py-3 font-medium">Fonte Kommo</th>
                <th className="px-4 py-3 font-medium">Agente</th>
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filteredNumbers.map((n) => {
                const isEditing = editingId === n.id;
                const teamUsers = getKommoUsers(n.team);

                return (
                  <tr key={n.id} className="border-b border-glass-border/50 hover:bg-surface-secondary/40 transition-colors">
                    <td className="px-4 py-3 text-foreground font-medium">{formatPhone(n.phone)}</td>
                    <td className="px-4 py-3 text-foreground">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editSource}
                          onChange={(e) => setEditSource(e.target.value)}
                          placeholder="Nome da fonte"
                          className={cn(inputClass, 'w-44')}
                        />
                      ) : (
                        n.kommo_source_name || '\u2014'
                      )}
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      {isEditing ? (
                        <select
                          value={editAgent}
                          onChange={(e) => setEditAgent(e.target.value)}
                          className={cn(inputClass, 'w-48')}
                        >
                          <option value="">Nenhum</option>
                          {teamUsers.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        getAgentName(n.kommo_user_id)
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={n.team === 'azul' ? 'bg-accent-blue/15 text-accent-blue' : 'bg-warning/15 text-warning'}>
                        {n.team}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleToggleActive(n)}
                        className="cursor-pointer"
                        title={n.active ? 'Clique para inativar' : 'Clique para ativar'}
                      >
                        <Badge className={cn(
                          'transition-colors',
                          n.active ? 'bg-success/10 text-success hover:bg-success/20' : 'bg-danger/10 text-danger hover:bg-danger/20'
                        )}>
                          {n.active ? 'Ativo' : 'Inativo'}
                        </Badge>
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        {isEditing ? (
                          <>
                            <button
                              onClick={() => saveEditing(n)}
                              className="inline-flex items-center gap-1 rounded-button px-2 py-1 text-body-sm text-success hover:bg-success/10 transition-colors cursor-pointer"
                              title="Salvar"
                            >
                              <Check className="h-3.5 w-3.5" />
                              Salvar
                            </button>
                            <button
                              onClick={cancelEditing}
                              className="inline-flex items-center gap-1 rounded-button px-2 py-1 text-body-sm text-muted hover:bg-surface-secondary transition-colors cursor-pointer"
                              title="Cancelar"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => startEditing(n)}
                              className="inline-flex items-center gap-1 rounded-button px-2 py-1 text-body-sm text-primary hover:bg-primary/10 transition-colors cursor-pointer"
                              title="Editar"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Editar
                            </button>
                            <button
                              onClick={() => handleDelete(n.id)}
                              className="inline-flex items-center gap-1 rounded-button px-2 py-1 text-body-sm text-danger hover:bg-danger/10 transition-colors cursor-pointer"
                              title="Remover"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Routing Logs */}
      <div>
        <h2 className="font-heading text-heading-sm mb-3">Últimos Roteamentos</h2>
        {loading ? (
          <div className="rounded-card border border-glass-border bg-surface p-4 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : logs.length === 0 ? (
          <p className="text-body-sm text-muted">Nenhum roteamento realizado ainda.</p>
        ) : (
          <div className="rounded-card border border-glass-border bg-surface overflow-x-auto">
            <table className="w-full text-left text-body-sm">
              <thead>
                <tr className="border-b border-glass-border text-muted">
                  <th className="px-4 py-3 font-medium">Data</th>
                  <th className="px-4 py-3 font-medium">Lead</th>
                  <th className="px-4 py-3 font-medium">Roteamento</th>
                  <th className="px-4 py-3 font-medium">Telefone</th>
                  <th className="px-4 py-3 font-medium">Fonte</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b border-glass-border/50 hover:bg-surface-secondary/40 transition-colors">
                    <td className="px-4 py-3 text-foreground whitespace-nowrap">{formatDateBR(log.routed_at)}</td>
                    <td className="px-4 py-3 text-foreground">{log.lead_name}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 text-foreground">
                        <span className="text-muted">#{log.from_user_id}</span>
                        <ArrowRight className="h-3.5 w-3.5 text-success" />
                        <span className="font-medium">{log.to_user_name || `#${log.to_user_id}`}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-foreground">{formatPhone(log.phone_matched)}</td>
                    <td className="px-4 py-3 text-muted">{log.source_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
