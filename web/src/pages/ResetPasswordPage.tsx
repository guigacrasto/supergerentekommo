import { useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircle2, XCircle, ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { Button, Input, Card } from '@/components/ui';
import { APP_NAME } from '@/lib/constants';

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  if (!token) {
    return (
      <Card className="w-full max-w-md p-8">
        <div className="flex flex-col items-center text-center py-4">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-danger/10">
            <XCircle className="h-8 w-8 text-danger" />
          </div>
          <h2 className="font-heading text-heading-sm mb-2">Link invalido</h2>
          <p className="text-body-md text-muted mb-6">
            Este link de recuperacao de senha e invalido ou expirou.
          </p>
          <Link
            to="/forgot-password"
            className="font-heading font-medium text-primary hover:underline"
          >
            Solicitar novo link
          </Link>
        </div>
      </Card>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('As senhas nao coincidem.');
      return;
    }

    if (password.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres.');
      return;
    }

    setLoading(true);

    try {
      await api.post('/auth/reset-password', { token, password });
      setSuccess(true);
      setTimeout(() => navigate('/login'), 3000);
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error || 'Erro ao redefinir senha. Tente novamente.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-md p-8">
      <div className="mb-8 flex flex-col items-center">
        <img src="/logo.svg" alt={APP_NAME} className="mb-4 h-14 w-14 rounded-card" />
        <h1 className="font-heading text-heading-lg">{APP_NAME}</h1>
        <p className="mt-1 text-body-md text-muted">Redefinir senha</p>
      </div>

      {success ? (
        <div className="flex flex-col items-center text-center py-4">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
            <CheckCircle2 className="h-8 w-8 text-success" />
          </div>
          <h2 className="font-heading text-heading-sm mb-2">Senha redefinida!</h2>
          <p className="text-body-md text-muted mb-6">
            Sua senha foi alterada com sucesso. Voce sera redirecionado para o login...
          </p>
          <Link
            to="/login"
            className="font-heading font-medium text-primary hover:underline"
          >
            Ir para o login
          </Link>
        </div>
      ) : (
        <>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Nova senha"
              type="password"
              placeholder="Sua nova senha"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
            />

            <Input
              label="Confirmar senha"
              type="password"
              placeholder="Confirme a nova senha"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
            />

            {error && (
              <div className="rounded-button bg-danger/10 px-3 py-2 text-body-sm text-danger">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full" loading={loading}>
              Redefinir senha
            </Button>
          </form>

          <p className="mt-6 text-center text-body-sm text-muted">
            <Link
              to="/login"
              className="flex items-center justify-center gap-2 font-medium text-primary hover:underline"
            >
              <ArrowLeft className="h-4 w-4" />
              Voltar para o login
            </Link>
          </p>
        </>
      )}
    </Card>
  );
}
