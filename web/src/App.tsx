import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
    MessageSquare,
    BarChart3,
    Settings,
    LogOut,
    ChevronRight,
    ChevronDown,
    Send,
    CheckCircle2,
    XCircle,
    HelpCircle,
    Filter,
    RefreshCw,
    PieChart,
    AlertTriangle,
    Clock,
    Sun,
    Moon
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Pipeline {
    id: number;
    name: string;
    team: 'azul' | 'amarela';
}

interface Message {
    role: 'user' | 'assistant';
    content: string;
    data?: any;
}

function LoginPage({ onLogin, onGoRegister }: { onLogin: (email: string, password: string) => Promise<void>; onGoRegister: () => void }) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setError('');
        const form = e.currentTarget;
        const email = (form.elements.namedItem('email') as HTMLInputElement).value;
        const password = (form.elements.namedItem('password') as HTMLInputElement).value;
        setLoading(true);
        try {
            await onLogin(email, password);
        } catch (err: any) {
            setError(err.response?.data?.error || 'Erro ao fazer login.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="auth-page">
            <div className="auth-card glass">
                <div className="brand">
                    <div className="logo">AK</div>
                    <span>AssistenteKommo</span>
                </div>
                <h2>Entrar</h2>
                {error && <div className="auth-error">{error}</div>}
                <form onSubmit={handleSubmit}>
                    <input name="email" type="email" placeholder="Email" required />
                    <input name="password" type="password" placeholder="Senha" required />
                    <button type="submit" disabled={loading}>{loading ? 'Entrando...' : 'Entrar'}</button>
                </form>
                <p>Não tem conta? <button type="button" onClick={onGoRegister}>Cadastrar</button></p>
            </div>
        </div>
    );
}

function RegisterPage({ onRegister, onGoLogin }: { onRegister: (name: string, email: string, password: string) => Promise<void>; onGoLogin: () => void }) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setError('');
        const form = e.currentTarget;
        const name = (form.elements.namedItem('name') as HTMLInputElement).value;
        const email = (form.elements.namedItem('email') as HTMLInputElement).value;
        const password = (form.elements.namedItem('password') as HTMLInputElement).value;
        setLoading(true);
        try {
            await onRegister(name, email, password);
            setSuccess(true);
        } catch (err: any) {
            setError(err.response?.data?.error || 'Erro ao cadastrar.');
        } finally {
            setLoading(false);
        }
    };

    if (success) {
        return (
            <div className="auth-page">
                <div className="auth-card glass">
                    <div className="brand"><div className="logo">AK</div><span>AssistenteKommo</span></div>
                    <h2>Cadastro realizado!</h2>
                    <p style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
                        Aguarde a aprovação do administrador para acessar o sistema.
                    </p>
                    <button type="button" className="back-to-login" onClick={onGoLogin}>Voltar ao login</button>
                </div>
            </div>
        );
    }

    return (
        <div className="auth-page">
            <div className="auth-card glass">
                <div className="brand"><div className="logo">AK</div><span>AssistenteKommo</span></div>
                <h2>Criar conta</h2>
                {error && <div className="auth-error">{error}</div>}
                <form onSubmit={handleSubmit}>
                    <input name="name" type="text" placeholder="Seu nome" required />
                    <input name="email" type="email" placeholder="Email" required />
                    <input name="password" type="password" placeholder="Senha (mín. 6 caracteres)" required minLength={6} />
                    <button type="submit" disabled={loading}>{loading ? 'Cadastrando...' : 'Criar conta'}</button>
                </form>
                <p>Já tem conta? <button type="button" onClick={onGoLogin}>Entrar</button></p>
            </div>
        </div>
    );
}

function App() {
    const [page, setPage] = useState<'login' | 'register' | 'app' | 'admin'>('login');
    const [authToken, setAuthToken] = useState<string | null>(null);
    const [currentUser, setCurrentUser] = useState<{ id: string; name: string; email: string; role: string } | null>(null);

    const [activeTab, setActiveTab] = useState('chat');
    const [messages, setMessages] = useState<Message[]>([
        { role: 'assistant', content: 'Olá! Sou o assistente inteligente do Kommo CRM. Tenho acesso aos dados reais dos seus funis — leads, conversões, agentes e muito mais. O que deseja saber?' }
    ]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [pipelines, setPipelines] = useState<Pipeline[]>([]);
    const [tabData, setTabData] = useState<any>(null);
    const [fromDate, setFromDate] = useState(new Date().toISOString().split('T')[0]);
    const [toDate, setToDate] = useState(new Date().toISOString().split('T')[0]);
    const [sessionId, setSessionId] = useState<string | null>(null);

    const [adminUsers, setAdminUsers] = useState<any[]>([]);
    const [adminTokens, setAdminTokens] = useState<any[]>([]);
    const [adminLoading, setAdminLoading] = useState(false);
    const [tokenStatus, setTokenStatus] = useState<Record<'azul' | 'amarela', { hasRefreshToken: boolean; expiresAt: string | null }> | null>(null);
    const [oauthCode, setOauthCode] = useState<Record<'azul' | 'amarela', string>>({ azul: '', amarela: '' });
    const [oauthMsg, setOauthMsg] = useState<Record<'azul' | 'amarela', string>>({ azul: '', amarela: '' });
    const [approveTeams, setApproveTeams] = useState<Record<string, { azul: boolean; amarela: boolean }>>({});
    const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set());
    const [filterAgente, setFilterAgente] = useState('');
    const [filterFunil, setFilterFunil] = useState('');
    const [filterEquipe, setFilterEquipe] = useState('');
    const [mentors, setMentors] = useState<Array<{id:string;name:string;description:string;system_prompt:string;methodology_text:string;is_active:boolean}>>([]);
    const [mentorForm, setMentorForm] = useState<{id?:string;name:string;description:string;system_prompt:string;methodology_text:string;is_active:boolean}>({name:'',description:'',system_prompt:'',methodology_text:'',is_active:true});
    const [mentorEditing, setMentorEditing] = useState(false);
    const [availableMentors, setAvailableMentors] = useState<Array<{id:string;name:string;description:string}>>([]);
    const [selectedMentorIds, setSelectedMentorIds] = useState<string[]>([]);
    const [sortCol, setSortCol] = useState<string | null>(null);
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
    const [alertFilter, setAlertFilter] = useState<'todos' | 'risco48h' | 'risco7d' | 'tarefas'>('todos');
    const [alertEquipeFilter, setAlertEquipeFilter] = useState<'todas' | 'azul' | 'amarela'>('todas');
    const [theme, setTheme] = useState<'dark' | 'light'>(() => {
        return (localStorage.getItem('ak_theme') as 'dark' | 'light') || 'dark';
    });

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('ak_theme', theme);
    }, [theme]);

    useEffect(() => {
        const token = localStorage.getItem('kommo_token');
        const userStr = localStorage.getItem('kommo_user');
        if (token && userStr) {
            const user = JSON.parse(userStr);
            setAuthToken(token);
            setCurrentUser(user);
            setPage('app');
            fetchPipelines(token);
        }
    }, []);

    const fetchPipelines = async (token?: string | null) => {
        const t = token ?? authToken;
        if (!t) return;
        try {
            console.log("App: fetching pipelines...");
            const res = await axios.get('/api/pipelines', {
                headers: { Authorization: `Bearer ${t}` }
            });
            console.log("App: pipelines received:", res.data);
            setPipelines(res.data);
            // Also fetch available mentors
            try {
                const mentorsRes = await axios.get('/api/chat/mentors', { headers: { Authorization: `Bearer ${t}` } });
                setAvailableMentors(mentorsRes.data);
            } catch {
                // mentors are optional — ignore errors
            }
        } catch (e) {
            console.error("App: error fetching pipelines", e);
        }
    };

    const handleLogin = async (email: string, password: string) => {
        const res = await axios.post('/api/auth/login', { email, password });
        const { token, user } = res.data;
        localStorage.setItem('kommo_token', token);
        localStorage.setItem('kommo_user', JSON.stringify(user));
        setAuthToken(token);
        setCurrentUser(user);
        setPage('app');
        fetchPipelines(token);
    };

    const handleRegister = async (name: string, email: string, password: string) => {
        await axios.post('/api/auth/register', { name, email, password });
    };

    const handleLogout = () => {
        localStorage.removeItem('kommo_token');
        localStorage.removeItem('kommo_user');
        setAuthToken(null);
        setCurrentUser(null);
        setPage('login');
        setPipelines([]);
        setSessionId(null);
        setMessages([{ role: 'assistant', content: 'Olá! Sou o assistente inteligente do Kommo CRM. Tenho acesso aos dados reais dos seus funis — leads, conversões, agentes e muito mais. O que deseja saber?' }]);
        setTabData(null);
        setAdminUsers([]);
        setAdminTokens([]);
        setExpandedTeams(new Set());
    };

    const loadAdminPanel = async () => {
        setAdminLoading(true);
        try {
            const [usersRes, tokensRes, statusRes, mentorsRes] = await Promise.all([
                axios.get('/api/admin/users', { headers: { Authorization: `Bearer ${authToken}` } }),
                axios.get('/api/admin/tokens', { headers: { Authorization: `Bearer ${authToken}` } }),
                axios.get('/api/oauth/status', { headers: { Authorization: `Bearer ${authToken}` } }),
                axios.get('/api/admin/mentors', { headers: { Authorization: `Bearer ${authToken}` } }),
            ]);
            setAdminUsers(usersRes.data);
            setAdminTokens(tokensRes.data);
            setTokenStatus(statusRes.data);
            setMentors(mentorsRes.data);
        } catch (e) {
            console.error("Admin load error", e);
        } finally {
            setAdminLoading(false);
        }
    };

    const handleOauthExchange = async (team: 'azul' | 'amarela') => {
        const code = oauthCode[team];
        if (!code.trim()) return;
        setOauthMsg(prev => ({ ...prev, [team]: '' }));
        try {
            const res = await axios.post(`/api/oauth/exchange?team=${team}`,
                { code: code.trim() },
                { headers: { Authorization: `Bearer ${authToken}` } }
            );
            setOauthMsg(prev => ({ ...prev, [team]: '✅ ' + res.data.message }));
            setOauthCode(prev => ({ ...prev, [team]: '' }));
            const statusRes = await axios.get('/api/oauth/status', { headers: { Authorization: `Bearer ${authToken}` } });
            setTokenStatus(statusRes.data);
        } catch (err: any) {
            setOauthMsg(prev => ({ ...prev, [team]: '❌ ' + (err.response?.data?.error || 'Erro ao trocar o código.') }));
        }
    };

    const openKommoAuth = async (team: 'azul' | 'amarela') => {
        const res = await axios.get(`/api/oauth/start?team=${team}`, { headers: { Authorization: `Bearer ${authToken}` } });
        window.open(res.data.authUrl, '_blank');
    };

    const handleApprove = async (userId: string) => {
        const sel = approveTeams[userId] || { azul: true, amarela: false };
        const teams = (['azul', 'amarela'] as const).filter(t => sel[t]);
        await axios.post(`/api/admin/users/${userId}/approve`, { teams }, {
            headers: { Authorization: `Bearer ${authToken}` }
        });
        loadAdminPanel();
    };

    const handleDeny = async (userId: string) => {
        await axios.post(`/api/admin/users/${userId}/deny`, {}, {
            headers: { Authorization: `Bearer ${authToken}` }
        });
        loadAdminPanel();
    };

    const handleSend = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || loading) return;

        const userMsg = input.trim();
        setInput('');
        setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
        setLoading(true);

        try {
            const res = await axios.post('/api/chat', { message: userMsg, sessionId, mentorIds: selectedMentorIds }, {
                headers: { Authorization: `Bearer ${authToken}` }
            });
            setSessionId(res.data.sessionId);
            setMessages(prev => [...prev, {
                role: 'assistant',
                content: res.data.response,
                data: res.data.data
            }]);
        } catch (e) {
            setMessages(prev => [...prev, { role: 'assistant', content: 'Erro ao processar sua mensagem.' }]);
        } finally {
            setLoading(false);
        }
    };

    const loadTabData = async (tab: string, useFilter: boolean = false) => {
        setActiveTab(tab);
        setLoading(true);
        if (!useFilter) setTabData(null);

        try {
            let res;
            if (tab === 'agents') {
                console.log("App: loading agent report...");
                res = await axios.get('/api/reports/agents', {
                    headers: { Authorization: `Bearer ${authToken}` }
                });
                setTabData(res.data);
                setFilterAgente('');
                setFilterFunil('');
                setFilterEquipe('');
            } else if (tab === 'summary') {
                res = await axios.get('/api/reports/summary', {
                    headers: { Authorization: `Bearer ${authToken}` }
                });
                setTabData(res.data);
            } else if (tab === 'alerts') {
                res = await axios.get('/api/reports/activity', {
                    headers: { Authorization: `Bearer ${authToken}` }
                });
                setTabData(res.data);
            } else if (tab.startsWith('brand-')) {
                const pid = tab.replace('brand-', '');
                console.log(`App: loading brand report for ${pid}...`);
                const params: any = {};
                if (fromDate) {
                    const startTs = new Date(fromDate + 'T00:00:00');
                    params.from = Math.floor(startTs.getTime() / 1000);
                }
                if (toDate) {
                    const endTs = new Date(toDate + 'T23:59:59');
                    params.to = Math.floor(endTs.getTime() / 1000);
                }

                res = await axios.get(`/api/leads/new/${pid}`, { params, headers: { Authorization: `Bearer ${authToken}` } });
                console.log(`App: brand report data for ${pid}:`, res.data);
                setTabData(res.data);
            }
        } catch (e) {
            console.error("App: error loading tab data", e);
        } finally {
            setLoading(false);
        }
    };

    const renderContent = () => {
        const FIXED_COLS = ['Agente', 'Total Leads', 'Venda Ganha', 'Venda Perdida', 'Conversão %'];
        const funilCols: string[] = (activeTab === 'agents' && Array.isArray(tabData) && tabData.length > 0)
            ? Object.keys(tabData[0]).filter((k: string) => !FIXED_COLS.includes(k))
            : [];
        const agentOptions: string[] = (activeTab === 'agents' && Array.isArray(tabData))
            ? [...new Set<string>(tabData.map((r: any) => r.Agente as string))].sort()
            : [];
        const funilToTeam = new Map<string, string>(
            pipelines.map(p => [p.name.replace('FUNIL ', '').trim(), p.team])
        );
        const filteredRows = (activeTab === 'agents' && Array.isArray(tabData))
            ? tabData.filter((row: any) => {
                if (filterAgente && row.Agente !== filterAgente) return false;
                if (filterFunil && !row[filterFunil]) return false;
                if (filterEquipe) {
                    const teamFunils = funilCols.filter(col => funilToTeam.get(col) === filterEquipe);
                    if (!teamFunils.some(col => row[col])) return false;
                }
                return true;
            })
            : [];

        const sortedRows = (sortCol && filteredRows.length > 0)
            ? [...filteredRows].sort((a, b) => {
                const parse = (v: any) => {
                    const s = String(v ?? '').replace(/\s*\(.*?\)/g, '').replace('%', '').trim();
                    const n = parseFloat(s);
                    return isNaN(n) ? s.toLowerCase() : n;
                };
                const an = parse(a[sortCol]), bn = parse(b[sortCol]);
                if (an < bn) return sortDir === 'asc' ? -1 : 1;
                if (an > bn) return sortDir === 'asc' ? 1 : -1;
                return 0;
            })
            : filteredRows;

        if (page === 'admin') {
            return (
                <div className="admin-panel">
                    <div className="admin-header">
                        <h1>Painel Admin</h1>
                        <button className="refresh-btn" onClick={loadAdminPanel} disabled={adminLoading}>
                            <RefreshCw size={16} className={adminLoading ? 'spin' : ''} /> Atualizar
                        </button>
                    </div>

                    <div className="admin-section">
                        <h2>Usuários</h2>
                        {adminUsers.length === 0 && !adminLoading && <p className="empty-text">Nenhum usuário cadastrado.</p>}
                        {adminUsers.length > 0 && (
                            <div className="table-card glass">
                                <div className="table-responsive">
                                    <table>
                                        <thead>
                                            <tr>
                                                <th>Nome</th>
                                                <th>Email</th>
                                                <th>Status</th>
                                                <th>Ações</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {adminUsers.map((u) => (
                                                <tr key={u.id}>
                                                    <td>{u.name}</td>
                                                    <td>{u.email}</td>
                                                    <td>
                                                        <span className={`status-badge ${u.status}`}>{u.status}</span>
                                                    </td>
                                                    <td>
                                                        {u.status !== 'approved' && (
                                                            <>
                                                                <label style={{ fontSize: '0.75rem', marginRight: '6px' }}>
                                                                    <input type="checkbox"
                                                                        checked={approveTeams[u.id]?.azul ?? true}
                                                                        onChange={e => setApproveTeams(prev => ({ ...prev, [u.id]: { ...(prev[u.id] || { azul: true, amarela: false }), azul: e.target.checked } }))}
                                                                    /> Azul
                                                                </label>
                                                                <label style={{ fontSize: '0.75rem', marginRight: '6px' }}>
                                                                    <input type="checkbox"
                                                                        checked={approveTeams[u.id]?.amarela ?? false}
                                                                        onChange={e => setApproveTeams(prev => ({ ...prev, [u.id]: { ...(prev[u.id] || { azul: true, amarela: false }), amarela: e.target.checked } }))}
                                                                    /> Amarela
                                                                </label>
                                                                <button className="action-btn approve" onClick={() => handleApprove(u.id)}>Aprovar</button>
                                                            </>
                                                        )}
                                                        {u.status !== 'denied' && (
                                                            <button className="action-btn deny" onClick={() => handleDeny(u.id)}>Negar</button>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="admin-section">
                        <h2>Token Kommo</h2>
                        {(['azul', 'amarela'] as const).map(team => (
                            <div key={team} style={{ marginBottom: '1rem' }}>
                                <p style={{ fontSize: '0.8rem', fontWeight: 700, color: team === 'azul' ? '#3b82f6' : '#f59e0b', marginBottom: '0.5rem' }}>
                                    {team === 'azul' ? 'Equipe Azul' : 'Equipe Amarela'}
                                </p>
                                <div className="token-status-card glass">
                                    <div className="token-info">
                                        <span className="token-label">Expira em:</span>
                                        <span className="token-value">{tokenStatus?.[team]?.expiresAt ?? '—'}</span>
                                    </div>
                                    <div className="token-info">
                                        <span className="token-label">Refresh token:</span>
                                        <span className={`status-badge ${tokenStatus?.[team]?.hasRefreshToken ? 'approved' : 'denied'}`}>
                                            {tokenStatus?.[team]?.hasRefreshToken ? 'configurado' : 'não configurado'}
                                        </span>
                                    </div>
                                    <div className="token-renew">
                                        <p className="token-instructions">
                                            Para renovar: clique em <strong>Autorizar Kommo</strong>, aprove o acesso,
                                            copie o parâmetro <code>code</code> da URL e cole abaixo.
                                        </p>
                                        <button className="action-btn approve" style={{ padding: '6px 16px' }} onClick={() => openKommoAuth(team)}>
                                            Autorizar Kommo ↗
                                        </button>
                                        <div className="oauth-input-row">
                                            <input
                                                type="text"
                                                placeholder="Cole o código aqui (parâmetro code=...)"
                                                value={oauthCode[team]}
                                                onChange={e => setOauthCode(prev => ({ ...prev, [team]: e.target.value }))}
                                            />
                                            <button className="action-btn approve" onClick={() => handleOauthExchange(team)} disabled={!oauthCode[team].trim()}>
                                                Confirmar
                                            </button>
                                        </div>
                                        {oauthMsg[team] && <p className="oauth-msg">{oauthMsg[team]}</p>}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="admin-section">
                        <h2>Uso de Tokens Gemini (30 dias)</h2>
                        {adminTokens.length === 0 && !adminLoading && <p className="empty-text">Sem dados de uso ainda.</p>}
                        {adminTokens.length > 0 && (
                            <div className="table-card glass">
                                <div className="table-responsive">
                                    <table>
                                        <thead>
                                            <tr>
                                                <th>Usuário</th>
                                                <th>Mensagens</th>
                                                <th>Tokens Entrada</th>
                                                <th>Tokens Saída</th>
                                                <th>Total Tokens</th>
                                                <th>Custo Est.</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {adminTokens.map((u) => (
                                                <tr key={u.userId}>
                                                    <td><div>{u.name}</div><div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{u.email}</div></td>
                                                    <td>{u.messages}</td>
                                                    <td>{u.promptTokens.toLocaleString()}</td>
                                                    <td>{u.completionTokens.toLocaleString()}</td>
                                                    <td className="highlight-cell">{u.totalTokens.toLocaleString()}</td>
                                                    <td>{u.estimatedCostUSD}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="admin-section">
                        <h2>🤖 Mentores / Agentes</h2>
                        <div className="mentor-form glass">
                            <input
                                placeholder="Nome do mentor"
                                value={mentorForm.name}
                                onChange={e => setMentorForm(f => ({...f, name: e.target.value}))}
                            />
                            <input
                                placeholder="Descrição curta"
                                value={mentorForm.description}
                                onChange={e => setMentorForm(f => ({...f, description: e.target.value}))}
                            />
                            <textarea
                                placeholder="Personalidade / Instruções (ex: Você é um coach agressivo de vendas...)"
                                rows={4}
                                value={mentorForm.system_prompt}
                                onChange={e => setMentorForm(f => ({...f, system_prompt: e.target.value}))}
                            />
                            <div className="file-upload-row">
                                <label className="file-upload-label">
                                    <span>Metodologia (.txt ou .md)</span>
                                    <input type="file" accept=".txt,.md" onChange={e => {
                                        const file = e.target.files?.[0];
                                        if (!file) return;
                                        const reader = new FileReader();
                                        reader.onload = ev => setMentorForm(f => ({...f, methodology_text: ev.target?.result as string || ''}));
                                        reader.readAsText(file);
                                    }} />
                                </label>
                                {mentorForm.methodology_text && <span className="file-ok">✅ Arquivo carregado ({Math.round(mentorForm.methodology_text.length / 1024)}KB)</span>}
                            </div>
                            <label className="checkbox-row">
                                <input
                                    type="checkbox"
                                    checked={mentorForm.is_active}
                                    onChange={e => setMentorForm(f => ({...f, is_active: e.target.checked}))}
                                />
                                Ativo (visível no chat)
                            </label>
                            <div className="form-actions">
                                <button className="action-btn approve" onClick={async () => {
                                    const method = mentorForm.id ? 'put' : 'post';
                                    const url = mentorForm.id ? `/api/admin/mentors/${mentorForm.id}` : '/api/admin/mentors';
                                    await axios[method](url, mentorForm, { headers: { Authorization: `Bearer ${authToken}` } });
                                    setMentorForm({name:'',description:'',system_prompt:'',methodology_text:'',is_active:true});
                                    setMentorEditing(false);
                                    loadAdminPanel();
                                }} disabled={!mentorForm.name.trim() || !mentorForm.system_prompt.trim()}>
                                    {mentorForm.id ? 'Salvar Alterações' : 'Criar Mentor'}
                                </button>
                                {mentorForm.id && (
                                    <button onClick={() => {
                                        setMentorForm({name:'',description:'',system_prompt:'',methodology_text:'',is_active:true});
                                        setMentorEditing(false);
                                    }}>
                                        Cancelar
                                    </button>
                                )}
                            </div>
                        </div>
                        <div className="mentor-list">
                            {mentors.length === 0 && !adminLoading && (
                                <div className="empty-text">Nenhum mentor criado ainda.</div>
                            )}
                            {mentors.map(m => (
                                <div key={m.id} className={`mentor-row glass ${!m.is_active ? 'inactive' : ''}`}>
                                    <div className="mentor-info">
                                        <strong className="mentor-name">{m.name}</strong>
                                        {m.description && <span className="mentor-desc">{m.description}</span>}
                                        {!m.is_active && <span className="status-badge denied">inativo</span>}
                                    </div>
                                    <div className="mentor-actions">
                                        <button className="action-btn" onClick={() => {
                                            setMentorForm({...m});
                                            setMentorEditing(true);
                                        }}>Editar</button>
                                        <button className="action-btn deny" onClick={async () => {
                                            if (!confirm(`Excluir mentor "${m.name}"?`)) return;
                                            await axios.delete(`/api/admin/mentors/${m.id}`, { headers: { Authorization: `Bearer ${authToken}` } });
                                            loadAdminPanel();
                                        }}>Excluir</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            );
        }

        if (activeTab === 'chat') {
            return (
                <div className="chat-container">
                    <div className="messages-list">
                        {messages.map((m, i) => (
                            <div key={i} className={`message-wrapper ${m.role === 'user' ? 'user' : 'assistant'}`}>
                                <div className="bubble glass">
                                    <div className="text markdown-body">
                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                                    </div>
                                    {m.data && (
                                        <div className="data-blob">
                                            <pre>{JSON.stringify(m.data, null, 2)}</pre>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                        {loading && (
                            <div className="message-wrapper assistant">
                                <div className="bubble glass pulse">...</div>
                            </div>
                        )}
                    </div>
                    {availableMentors.length > 0 && (
                        <div className="mentor-selector">
                            <span className="mentor-selector-label">Mentor:</span>
                            <button
                                type="button"
                                className={`mentor-chip ${selectedMentorIds.length === 0 ? 'active' : ''}`}
                                onClick={() => {
                                    setSelectedMentorIds([]);
                                    setMessages([{role:'assistant',content:'Olá! Sou o assistente inteligente do Kommo CRM. Tenho acesso aos dados reais dos seus funis — leads, conversões, agentes e muito mais. O que deseja saber?'}]);
                                    setSessionId(null);
                                }}
                            >
                                🤖 Padrão
                            </button>
                            {availableMentors.length > 1 && (
                                <button
                                    type="button"
                                    className={`mentor-chip ${selectedMentorIds.length === availableMentors.length && availableMentors.length > 0 ? 'active council' : ''}`}
                                    title="Consultar todos os mentores simultaneamente"
                                    onClick={() => {
                                        const allIds = availableMentors.map(m => m.id);
                                        setSelectedMentorIds(allIds);
                                        setMessages([{role:'assistant',content:`⚖️ Conselho completo ativado — ${availableMentors.length} mentores vão responder em paralelo. Faça sua pergunta.`}]);
                                        setSessionId(null);
                                    }}
                                >
                                    ⚖️ Conselho Completo
                                </button>
                            )}
                            {availableMentors.map(m => (
                                <button
                                    key={m.id}
                                    type="button"
                                    className={`mentor-chip ${selectedMentorIds.includes(m.id) ? 'active' : ''}`}
                                    title={m.description}
                                    onClick={() => {
                                        setSelectedMentorIds(prev => {
                                            const next = prev.includes(m.id)
                                                ? prev.filter(id => id !== m.id)
                                                : [...prev, m.id];
                                            const newCount = next.length;
                                            const welcomeMsg = newCount === 0
                                                ? 'Olá! Sou o assistente inteligente do Kommo CRM. Tenho acesso aos dados reais dos seus funis — leads, conversões, agentes e muito mais. O que deseja saber?'
                                                : newCount === 1
                                                ? `Olá! Sou ${availableMentors.find(x => next.includes(x.id))?.name ?? 'o mentor'}. Como posso ajudar?`
                                                : `⚖️ Conselho ativado com ${newCount} mentores. Faça sua pergunta.`;
                                            setMessages([{role:'assistant',content:welcomeMsg}]);
                                            setSessionId(null);
                                            return next;
                                        });
                                    }}
                                >
                                    {m.name}
                                </button>
                            ))}
                        </div>
                    )}
                    <form className="input-bar glass" onSubmit={handleSend}>
                        <input
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="Ex: Quantos leads ativos hoje? Quem fechou mais essa semana?"
                        />
                        <button type="submit" disabled={loading}>
                            <Send size={18} />
                        </button>
                    </form>
                </div>
            );
        }

        if (activeTab === 'summary') {
            const teams = ['azul', 'amarela'] as const;
            const summaryItems: any[] = Array.isArray(tabData) ? tabData : [];
            return (
                <div className="tab-view">
                    <header className="view-header">
                        <div className="title-area">
                            <h1>Resumo Geral</h1>
                        </div>
                    </header>
                    <section className="view-body">
                        {loading ? (
                            <div className="loading">
                                <RefreshCw className="spin" />
                                <span>Processando dados...</span>
                            </div>
                        ) : summaryItems.length > 0 ? (
                            <div className="summary-content">
                                {teams
                                    .filter(team => summaryItems.some((f: any) => f.team === team))
                                    .map(team => (
                                        <div key={team} className="summary-team-section">
                                            <h2 className={`summary-team-title ${team}`}>
                                                {team === 'azul' ? 'Equipe Azul' : 'Equipe Amarela'}
                                            </h2>
                                            <div className="summary-grid">
                                                {summaryItems
                                                    .filter((f: any) => f.team === team)
                                                    .map((funil: any) => (
                                                        <div key={`${funil.team}-${funil.nome}`} className={`summary-card glass team-border-${team}`}>
                                                            <div className="summary-card-name">
                                                                {(funil.nome ?? '').replace('FUNIL ', '')}
                                                            </div>
                                                            <div className="summary-stats">
                                                                <div className="summary-stat">
                                                                    <span className="summary-value highlight">{funil.novosHoje}</span>
                                                                    <span className="summary-label">últimas 24h</span>
                                                                </div>
                                                                <div className="summary-stat">
                                                                    <span className="summary-value">{funil.novosMes}</span>
                                                                    <span className="summary-label">este mês</span>
                                                                </div>
                                                                <div className="summary-stat">
                                                                    <span className="summary-value">{funil.ativos}</span>
                                                                    <span className="summary-label">ativos</span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))
                                                }
                                            </div>
                                        </div>
                                    ))
                                }
                            </div>
                        ) : (
                            <div className="empty">Nenhum dado disponível.</div>
                        )}
                    </section>
                </div>
            );
        }

        if (activeTab === 'alerts') {
            const alertsData: Array<{
                team: string;
                label: string;
                activity: {
                    leadsAbandonados48h: Array<{ id: number; nome: string; vendedor: string; diasSemAtividade: number; kommoUrl: string }>;
                    leadsEmRisco7d: Array<{ id: number; nome: string; vendedor: string; diasSemAtividade: number; kommoUrl: string }>;
                    tarefasVencidas: Array<{ id: number; texto: string; vendedor: string; leadId: number; leadNome: string; diasVencida: number; kommoUrl: string }>;
                };
            }> = Array.isArray(tabData) ? tabData : [];

            const totalAlertas = alertsData
                .filter(t => alertEquipeFilter === 'todas' || t.team === alertEquipeFilter)
                .reduce((sum, t) => {
                    const ab = alertFilter === 'todos' || alertFilter === 'risco48h' ? t.activity.leadsAbandonados48h.length : 0;
                    const risco = alertFilter === 'todos' || alertFilter === 'risco7d' ? t.activity.leadsEmRisco7d.length : 0;
                    const tar = alertFilter === 'todos' || alertFilter === 'tarefas' ? t.activity.tarefasVencidas.length : 0;
                    return sum + ab + risco + tar;
                }, 0);

            return (
                <div className="tab-view">
                    <header className="view-header">
                        <div className="title-area">
                            <h1>Painel de Alertas</h1>
                        </div>
                    </header>
                    <section className="view-body">
                        <div className="alert-filter-bar glass">
                            <div className="alert-filter-group">
                                <span className="alert-filter-label">Tipo:</span>
                                {(['todos', 'risco48h', 'risco7d', 'tarefas'] as const).map(f => (
                                    <button key={f} className={`alert-filter-chip ${alertFilter === f ? 'active' : ''}`}
                                        onClick={() => setAlertFilter(f)}>
                                        {f === 'todos' ? 'Todos' : f === 'risco48h' ? '⚠️ +48h' : f === 'risco7d' ? '🔴 +7 dias' : '📋 Tarefas'}
                                    </button>
                                ))}
                            </div>
                            <div className="alert-filter-group">
                                <span className="alert-filter-label">Equipe:</span>
                                {(['todas', 'azul', 'amarela'] as const).map(e => (
                                    <button key={e} className={`alert-filter-chip ${alertEquipeFilter === e ? 'active' : ''}`}
                                        onClick={() => setAlertEquipeFilter(e)}>
                                        {e === 'todas' ? 'Todas' : e === 'azul' ? 'Equipe Azul' : 'Equipe Amarela'}
                                    </button>
                                ))}
                            </div>
                        </div>
                        {loading ? (
                            <div className="loading">
                                <RefreshCw className="spin" />
                                <span>Carregando alertas...</span>
                            </div>
                        ) : alertsData.length === 0 ? (
                            <div className="empty">Nenhum dado disponível.</div>
                        ) : totalAlertas === 0 ? (
                            <div className="alerts-all-clear glass">
                                <CheckCircle2 size={40} />
                                <p>Tudo em dia! Nenhum alerta no momento.</p>
                            </div>
                        ) : (
                            <div className="alerts-content">
                                {alertsData.filter(({ team }) => alertEquipeFilter === 'todas' || team === alertEquipeFilter).map(({ team, label, activity }) => (
                                    <div key={team} className="alerts-team-section">
                                        <h2 className={`alerts-team-title ${team}`}>{label}</h2>

                                        {(alertFilter === 'todos' || alertFilter === 'risco48h') && activity.leadsAbandonados48h.length > 0 && (
                                            <div className="alert-section alert-red">
                                                <div className="alert-section-header">
                                                    <AlertTriangle size={16} />
                                                    <span>Sem atividade há +48h — {activity.leadsAbandonados48h.length} lead{activity.leadsAbandonados48h.length !== 1 ? 's' : ''}</span>
                                                </div>
                                                {activity.leadsAbandonados48h.map((lead) => (
                                                    <a
                                                        key={lead.id}
                                                        href={lead.kommoUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="alert-row glass"
                                                    >
                                                        <span className="alert-lead-name">{lead.nome}</span>
                                                        <span className="alert-meta">{lead.vendedor}</span>
                                                        <span className="alert-badge red">{lead.diasSemAtividade}d</span>
                                                    </a>
                                                ))}
                                            </div>
                                        )}

                                        {(alertFilter === 'todos' || alertFilter === 'risco7d') && activity.leadsEmRisco7d.length > 0 && (
                                            <div className="alert-section alert-yellow">
                                                <div className="alert-section-header">
                                                    <Clock size={16} />
                                                    <span>Em risco (sem atividade +7d) — {activity.leadsEmRisco7d.length} lead{activity.leadsEmRisco7d.length !== 1 ? 's' : ''}</span>
                                                </div>
                                                {activity.leadsEmRisco7d.map((lead) => (
                                                    <a
                                                        key={lead.id}
                                                        href={lead.kommoUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="alert-row glass"
                                                    >
                                                        <span className="alert-lead-name">{lead.nome}</span>
                                                        <span className="alert-meta">{lead.vendedor}</span>
                                                        <span className="alert-badge yellow">{lead.diasSemAtividade}d</span>
                                                    </a>
                                                ))}
                                            </div>
                                        )}

                                        {(alertFilter === 'todos' || alertFilter === 'tarefas') && activity.tarefasVencidas.length > 0 && (
                                            <div className="alert-section alert-orange">
                                                <div className="alert-section-header">
                                                    <XCircle size={16} />
                                                    <span>Tarefas vencidas — {activity.tarefasVencidas.length}</span>
                                                </div>
                                                {activity.tarefasVencidas.map((task) => (
                                                    <a
                                                        key={task.id}
                                                        href={task.kommoUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="alert-row glass"
                                                    >
                                                        <span className="alert-lead-name">{task.leadNome}</span>
                                                        <span className="alert-meta">{task.vendedor} · {task.texto}</span>
                                                        <span className="alert-badge orange">{task.diasVencida}d</span>
                                                    </a>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>
                </div>
            );
        }

        const currentPipe = pipelines.find(p => `brand-${p.id}` === activeTab);
        const title = activeTab === 'agents' ? 'Relatório de Performance' : `Novos Leads: ${currentPipe?.name.replace('FUNIL ', '') || 'Marca'}`;

        return (
            <div className="tab-view">
                <header className="view-header">
                    <div className="title-area">
                        <h1>{title}</h1>
                        {tabData?.fetchedAt && (
                            <div className="timestamp" style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '5px' }}>
                                <Clock size={14} /> <span>Atualizado em: {tabData.fetchedAt}</span>
                            </div>
                        )}
                    </div>
                    <div className="filter-controls glass">
                        {activeTab === 'agents' && (
                            <>
                                <div className="field">
                                    <span>Agente</span>
                                    <select value={filterAgente} onChange={e => setFilterAgente(e.target.value)}>
                                        <option value="">Todos</option>
                                        {agentOptions.map(a => <option key={a} value={a}>{a}</option>)}
                                    </select>
                                </div>
                                <div className="field">
                                    <span>Funil</span>
                                    <select value={filterFunil} onChange={e => setFilterFunil(e.target.value)}>
                                        <option value="">Todos</option>
                                        {funilCols.map(f => <option key={f} value={f}>{f}</option>)}
                                    </select>
                                </div>
                                <div className="field">
                                    <span>Equipe</span>
                                    <select value={filterEquipe} onChange={e => setFilterEquipe(e.target.value)}>
                                        <option value="">Todas</option>
                                        <option value="azul">Equipe Azul</option>
                                        <option value="amarela">Equipe Amarela</option>
                                    </select>
                                </div>
                            </>
                        )}
                        <div className="field">
                            <span>De</span>
                            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
                        </div>
                        <div className="field">
                            <span>Até</span>
                            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
                        </div>
                        <div className="actions">
                            <button className="primary" onClick={() => loadTabData(activeTab, true)}>
                                <Filter size={14} /> Filtrar
                            </button>
                            <button onClick={() => {
                                const today = new Date().toISOString().split('T')[0];
                                setFromDate(today);
                                setToDate(today);
                                loadTabData(activeTab);
                            }}>
                                Limpar
                            </button>
                        </div>
                    </div>
                </header>

                <section className="view-body">
                    {loading ? (
                        <div className="loading">
                            <RefreshCw className="spin" />
                            <span>Processando dados...</span>
                        </div>
                    ) : tabData ? (
                        activeTab === 'agents' ? (
                            <div className="table-card glass">
                                <div className="table-responsive">
                                    <table>
                                        <thead>
                                            <tr>
                                                {Object.keys(tabData[0] || {}).map(k => (
                                                    <th key={k} className="sortable-th" onClick={() => {
                                                        if (sortCol === k) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
                                                        else { setSortCol(k); setSortDir('desc'); }
                                                    }}>
                                                        {k}{sortCol === k && <span className="sort-indicator">{sortDir === 'desc' ? ' ↓' : ' ↑'}</span>}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {sortedRows.map((row: any, i: number) => (
                                                <tr key={i}>
                                                    {Object.entries(row).map(([key, v]: [string, any], j) => (
                                                        <td key={j} className={key === 'Ticket Médio' ? 'highlight-cell' : ''}>
                                                            {v}
                                                        </td>
                                                    ))}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        ) : (
                            <div className="metrics-grid">
                                <div className="metric-box glass highlight">
                                    <span className="label">Leads Criados</span>
                                    <span className="value">{tabData.created}</span>
                                    <span className="sub">No período selecionado</span>
                                </div>
                                <div className="metric-box glass warning">
                                    <span className="label">Ainda na Etapa</span>
                                    <span className="value">{tabData.remaining}</span>
                                    <span className="sub">Novos leads sem movimento</span>
                                </div>
                                <div className="metric-box glass info">
                                    <span className="label">Período Selecionado</span>
                                    <span className="value small">{tabData.period}</span>
                                    <span className="sub">Filtro aplicado (GMT-3)</span>
                                </div>
                            </div>
                        )
                    ) : (
                        <div className="empty glass">
                            <PieChart size={48} />
                            <p>Clique em filtrar para visualizar os dados fidedignos para o período selecionado.</p>
                        </div>
                    )}
                </section>
            </div>
        );
    };

    if (page === 'login') {
        return (
            <LoginPage
                onLogin={handleLogin}
                onGoRegister={() => setPage('register')}
            />
        );
    }

    if (page === 'register') {
        return (
            <RegisterPage
                onRegister={handleRegister}
                onGoLogin={() => setPage('login')}
            />
        );
    }

    return (
        <div className="app-layout">
            <aside className="sidebar">
                <div className="brand">
                    <div className="logo">AK</div>
                    <span>AssistenteKommo</span>
                </div>

                {currentUser && (
                    <div className="user-info">
                        <div className="user-avatar">{currentUser.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}</div>
                        <div>
                            <span className="user-name">{currentUser.name}</span>
                            <span className="user-role">{currentUser.role}</span>
                        </div>
                    </div>
                )}

                <nav>
                    <div className="group">
                        <label>Principal</label>
                        <button
                            className={activeTab === 'chat' && page !== 'admin' ? 'active' : ''}
                            onClick={() => { setPage('app'); setActiveTab('chat'); }}
                        >
                            <MessageSquare size={18} /> Chat
                        </button>
                        <button
                            className={activeTab === 'agents' && page !== 'admin' ? 'active' : ''}
                            onClick={() => { setPage('app'); loadTabData('agents'); }}
                        >
                            <BarChart3 size={18} /> Agentes
                        </button>
                        <button
                            className={activeTab === 'summary' && page !== 'admin' ? 'active' : ''}
                            onClick={() => { setPage('app'); loadTabData('summary'); }}
                        >
                            <PieChart size={18} /> Resumo
                        </button>
                        <button
                            className={activeTab === 'alerts' && page !== 'admin' ? 'active' : ''}
                            onClick={() => { setPage('app'); loadTabData('alerts'); }}
                        >
                            <AlertTriangle size={18} /> Alertas
                        </button>
                    </div>

                    {(['azul', 'amarela'] as const)
                        .filter(team => pipelines.some(p => p.team === team))
                        .map(team => (
                            <div className="group" key={team}>
                                <label
                                    className={`team-label ${team} accordion-label`}
                                    onClick={() => setExpandedTeams(prev => {
                                        const next = new Set(prev);
                                        next.has(team) ? next.delete(team) : next.add(team);
                                        return next;
                                    })}
                                >
                                    {expandedTeams.has(team)
                                        ? <ChevronDown size={14} />
                                        : <ChevronRight size={14} />}
                                    {team === 'azul' ? 'Equipe Azul' : 'Equipe Amarela'}
                                </label>
                                {expandedTeams.has(team) && pipelines.filter(p => p.team === team).map(p => (
                                    <button
                                        key={p.id}
                                        className={activeTab === `brand-${p.id}` && page !== 'admin' ? 'active' : ''}
                                        onClick={() => { setPage('app'); loadTabData(`brand-${p.id}`); }}
                                    >
                                        <ChevronRight size={14} /> {p.name.replace('FUNIL ', '').substring(0, 15)}
                                    </button>
                                ))}
                            </div>
                        ))
                    }
                </nav>

                <div className="user-section">
                    <div className="user-actions">
                        {currentUser?.role === 'admin' && (
                            <button
                                className={page === 'admin' ? 'active' : ''}
                                onClick={() => { setPage('admin'); loadAdminPanel(); }}
                            >
                                <Settings size={18} /> Admin
                            </button>
                        )}
                        {page === 'admin' && (
                            <button onClick={() => setPage('app')}>
                                <MessageSquare size={18} /> Voltar
                            </button>
                        )}
                        <button className="theme-toggle" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}>
                            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
                            {theme === 'dark' ? 'Modo Claro' : 'Modo Escuro'}
                        </button>
                        <button className="logout-btn" onClick={handleLogout}>
                            <LogOut size={18} /> Sair
                        </button>
                    </div>
                </div>
                <div className="sidebar-copyright">&copy; 2026 Antigravity</div>
            </aside>

            <main className="content">
                {renderContent()}
            </main>
        </div>
    );
}

export default App;
