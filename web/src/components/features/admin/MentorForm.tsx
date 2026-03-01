import { useState, useEffect, useRef } from 'react';
import { Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { Button, Input, Card } from '@/components/ui';
import type { MentorFormData } from '@/types';

interface MentorFormProps {
  mentor?: MentorFormData;
  onSave: () => void;
  onCancel: () => void;
}

const EMPTY_FORM: MentorFormData = {
  name: '',
  description: '',
  system_prompt: '',
  methodology_text: '',
  is_active: true,
};

export function MentorForm({ mentor, onSave, onCancel }: MentorFormProps) {
  const [form, setForm] = useState<MentorFormData>(mentor || EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const isEdit = !!mentor?.id;

  useEffect(() => {
    setForm(mentor || EMPTY_FORM);
    setFileName('');
    setError('');
  }, [mentor]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text === 'string') {
        setForm((prev) => ({ ...prev, methodology_text: text }));
        setFileName(file.name);
      }
    };
    reader.readAsText(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isEdit) {
        await api.put(`/admin/mentors/${mentor!.id}`, form);
      } else {
        await api.post('/admin/mentors', form);
      }
      onSave();
    } catch (err) {
      console.error('[MentorForm] Erro ao salvar:', err);
      setError('Erro ao salvar mentor. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="p-6">
      <h3 className="font-heading text-heading-sm mb-4">
        {isEdit ? 'Editar Mentor' : 'Novo Mentor'}
      </h3>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Nome"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          required
          placeholder="Nome do mentor"
        />

        <Input
          label="Descricao"
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          required
          placeholder="Breve descricao do mentor"
        />

        <div className="flex flex-col gap-1.5">
          <label className="text-label text-muted-light">Prompt do Sistema</label>
          <textarea
            value={form.system_prompt}
            onChange={(e) =>
              setForm((f) => ({ ...f, system_prompt: e.target.value }))
            }
            required
            rows={5}
            placeholder="Instrucoes de comportamento do mentor..."
            className="w-full rounded-input border border-glass-border bg-surface-secondary px-3 py-2 text-body-md text-[#E0E3E9] placeholder:text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors duration-150 light:bg-surface-light light:text-[#23272C] light:border-glass-border-light resize-y"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-label text-muted-light">Texto de Metodologia</label>
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="h-4 w-4" />
              Upload .txt / .md
            </Button>
            {fileName && (
              <span className="text-body-sm text-muted">{fileName}</span>
            )}
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.md"
              onChange={handleFileUpload}
              className="hidden"
            />
          </div>
          {form.methodology_text && (
            <div className="mt-1 max-h-32 overflow-y-auto rounded-input border border-glass-border bg-surface-secondary p-3 text-body-sm text-muted">
              {form.methodology_text.slice(0, 500)}
              {form.methodology_text.length > 500 && '...'}
            </div>
          )}
        </div>

        <label className="flex items-center gap-2 text-body-md cursor-pointer">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) =>
              setForm((f) => ({ ...f, is_active: e.target.checked }))
            }
            className="accent-primary"
          />
          Mentor ativo
        </label>

        {error && (
          <div className="rounded-button bg-danger/10 px-3 py-2 text-body-sm text-danger">
            {error}
          </div>
        )}

        <div className="flex items-center gap-3 pt-2">
          <Button type="submit" loading={loading}>
            {isEdit ? 'Salvar Alteracoes' : 'Criar Mentor'}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      </form>
    </Card>
  );
}
