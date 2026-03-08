import { useState, useEffect } from 'react';
import { User as UserIcon, Shield, Calendar, Save, Lock } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { Button, Input, Card, Badge } from '@/components/ui';
import { Spinner } from '@/components/ui';

interface ProfileData {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  teams: string[];
  phone: string | null;
  created_at: string;
}

export function ProfilePage() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.login);
  const token = useAuthStore((s) => s.token);

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);

  // Profile form
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [profileMsg, setProfileMsg] = useState('');
  const [profileError, setProfileError] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // Password form
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMsg, setPasswordMsg] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const { data } = await api.get<ProfileData>('/auth/profile');
      setProfile(data);
      setName(data.name);
      setPhone(data.phone || '');
    } catch {
      setProfileError('Erro ao carregar perfil.');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileMsg('');
    setProfileError('');
    setSavingProfile(true);

    try {
      await api.patch('/auth/profile', { name, phone });
      setProfileMsg('Perfil atualizado com sucesso.');
      // Update Zustand store
      if (user && token) {
        setUser(token, { ...user, name, phone });
      }
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error || 'Erro ao atualizar perfil.';
      setProfileError(message);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordMsg('');
    setPasswordError('');

    if (newPassword !== confirmPassword) {
      setPasswordError('As senhas nao coincidem.');
      return;
    }

    if (newPassword.length < 6) {
      setPasswordError('A nova senha deve ter pelo menos 6 caracteres.');
      return;
    }

    setSavingPassword(true);

    try {
      await api.patch('/auth/password', { currentPassword, newPassword });
      setPasswordMsg('Senha alterada com sucesso.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error || 'Erro ao alterar senha.';
      setPasswordError(message);
    } finally {
      setSavingPassword(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 md:p-6">
      <h1 className="font-heading text-heading-lg">Meu Perfil</h1>

      {/* Profile Info Card */}
      <Card className="p-6">
        <div className="mb-6 flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/20">
            <UserIcon className="h-7 w-7 text-primary" />
          </div>
          <div className="flex-1">
            <h2 className="font-heading text-heading-sm">{profile?.name}</h2>
            <p className="text-body-sm text-muted">{profile?.email}</p>
          </div>
          <Badge variant={profile?.role === 'admin' ? 'warning' : 'default'}>
            <Shield className="mr-1 h-3 w-3" />
            {profile?.role === 'admin' ? 'Admin' : 'Usuario'}
          </Badge>
        </div>

        {profile?.created_at && (
          <div className="mb-6 flex items-center gap-2 text-body-sm text-muted">
            <Calendar className="h-4 w-4" />
            <span>
              Membro desde{' '}
              {new Date(profile.created_at).toLocaleDateString('pt-BR', {
                day: '2-digit',
                month: 'long',
                year: 'numeric',
              })}
            </span>
          </div>
        )}

        <form onSubmit={handleSaveProfile} className="space-y-4">
          <Input
            label="Nome"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoComplete="name"
          />

          <Input
            label="Email"
            type="email"
            value={profile?.email || ''}
            disabled
            autoComplete="email"
          />

          <Input
            label="Telefone"
            type="tel"
            placeholder="(11) 99999-9999"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="tel"
          />

          {profileMsg && (
            <div className="rounded-button bg-success/10 px-3 py-2 text-body-sm text-success">
              {profileMsg}
            </div>
          )}
          {profileError && (
            <div className="rounded-button bg-danger/10 px-3 py-2 text-body-sm text-danger">
              {profileError}
            </div>
          )}

          <Button type="submit" loading={savingProfile}>
            <Save className="mr-2 h-4 w-4" />
            Salvar alteracoes
          </Button>
        </form>
      </Card>

      {/* Change Password Card */}
      <Card className="p-6">
        <div className="mb-6 flex items-center gap-3">
          <Lock className="h-5 w-5 text-primary" />
          <h2 className="font-heading text-heading-sm">Alterar senha</h2>
        </div>

        <form onSubmit={handleChangePassword} className="space-y-4">
          <Input
            label="Senha atual"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            autoComplete="current-password"
          />

          <Input
            label="Nova senha"
            type="password"
            placeholder="Minimo 6 caracteres"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={6}
            autoComplete="new-password"
          />

          <Input
            label="Confirmar nova senha"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={6}
            autoComplete="new-password"
          />

          {passwordMsg && (
            <div className="rounded-button bg-success/10 px-3 py-2 text-body-sm text-success">
              {passwordMsg}
            </div>
          )}
          {passwordError && (
            <div className="rounded-button bg-danger/10 px-3 py-2 text-body-sm text-danger">
              {passwordError}
            </div>
          )}

          <Button type="submit" loading={savingPassword}>
            <Lock className="mr-2 h-4 w-4" />
            Alterar senha
          </Button>
        </form>
      </Card>
    </div>
  );
}
