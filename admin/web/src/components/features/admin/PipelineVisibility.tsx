import { useState, useEffect, useCallback } from 'react';
import { Eye, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, EmptyState } from '@/components/ui';

interface PipelineVisibilityItem {
  pipeline_id: number;
  pipeline_name: string;
  team: string;
  visible: boolean;
}

export function PipelineVisibility() {
  const [pipelines, setPipelines] = useState<PipelineVisibilityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await api.get<PipelineVisibilityItem[]>('/admin/pipeline-visibility');
      setPipelines(res.data);
    } catch (err) {
      console.error('[PipelineVisibility] Erro ao carregar:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleToggle = async (item: PipelineVisibilityItem) => {
    const key = `${item.team}:${item.pipeline_id}`;
    setTogglingId(key);

    // Optimistic update
    setPipelines((prev) =>
      prev.map((p) =>
        p.team === item.team && p.pipeline_id === item.pipeline_id
          ? { ...p, visible: !p.visible }
          : p
      )
    );

    try {
      await api.put('/admin/pipeline-visibility', {
        team: item.team,
        pipeline_id: item.pipeline_id,
        pipeline_name: item.pipeline_name,
        visible: !item.visible,
      });
    } catch (err) {
      console.error('[PipelineVisibility] Erro ao atualizar:', err);
      // Revert on error
      setPipelines((prev) =>
        prev.map((p) =>
          p.team === item.team && p.pipeline_id === item.pipeline_id
            ? { ...p, visible: item.visible }
            : p
        )
      );
    } finally {
      setTogglingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const azulPipelines = pipelines.filter((p) => p.team === 'azul');
  const amarelaPipelines = pipelines.filter((p) => p.team === 'amarela');

  if (pipelines.length === 0) {
    return (
      <EmptyState
        icon={Eye}
        title="Nenhum pipeline encontrado"
        description="Nao ha pipelines configurados nas equipes."
      />
    );
  }

  const renderTeamColumn = (
    teamLabel: string,
    teamPipelines: PipelineVisibilityItem[]
  ) => (
    <Card>
      <div className="p-5">
        <h3 className="font-heading text-heading-sm mb-4">{teamLabel}</h3>
        {teamPipelines.length === 0 ? (
          <p className="text-body-sm text-muted">Nenhum pipeline nesta equipe.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {teamPipelines.map((p) => {
              const key = `${p.team}:${p.pipeline_id}`;
              const isToggling = togglingId === key;
              return (
                <label
                  key={key}
                  className="flex items-center justify-between gap-3 rounded-button border border-glass-border/50 px-4 py-3 cursor-pointer hover:bg-surface-secondary/50 transition-colors"
                >
                  <span className="text-body-md">{p.pipeline_name}</span>
                  <div className="flex items-center gap-2">
                    {isToggling && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />
                    )}
                    <input
                      type="checkbox"
                      checked={p.visible}
                      onChange={() => handleToggle(p)}
                      disabled={isToggling}
                      className="accent-primary h-4 w-4"
                    />
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      {renderTeamColumn('Equipe Azul', azulPipelines)}
      {renderTeamColumn('Equipe Amarela', amarelaPipelines)}
    </div>
  );
}
