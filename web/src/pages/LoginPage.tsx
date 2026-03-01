import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { Button, Input, Card } from '@/components/ui';
import { APP_NAME, APP_SHORT_NAME, APP_DESCRIPTION } from '@/lib/constants';
import type { User } from '@/types';

interface LoginResponse {
  token: string;
  user: User;
}

export function LoginPage() {
  const login = useAuthStore((s) => s.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { data } = await api.post<LoginResponse>('/auth/login', {
        email,
        password,
      });
      login(data.token, data.user);
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error || 'Erro ao fazer login. Tente novamente.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-md p-8">
      {/* Logo */}
      <div className="mb-8 flex flex-col items-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-card bg-gradient-to-br from-primary to-accent-blue font-heading text-heading-lg text-white">
          {APP_SHORT_NAME}
        </div>
        <h1 className="font-heading text-heading-lg">{APP_NAME}</h1>
        <p className="mt-1 text-body-md text-muted">
          {APP_DESCRIPTION}
        </p>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Email"
          type="email"
          placeholder="seu@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />

        <Input
          label="Senha"
          type="password"
          placeholder="Sua senha"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
        />

        {error && (
          <div className="rounded-button bg-danger/10 px-3 py-2 text-body-sm text-danger">
            {error}
          </div>
        )}

        <Button type="submit" className="w-full" loading={loading}>
          Entrar
        </Button>
      </form>

      {/* Register link */}
      <p className="mt-6 text-center text-body-sm text-muted">
        Nao tem conta?{' '}
        <Link
          to="/register"
          className="font-medium text-primary hover:underline"
        >
          Criar conta
        </Link>
      </p>
    </Card>
  );
}
