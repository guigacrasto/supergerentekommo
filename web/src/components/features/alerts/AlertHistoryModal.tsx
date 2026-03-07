import { X, Clock } from 'lucide-react';

interface AlertHistoryEntry {
  type: string;
  date: string;
}

interface AlertHistoryModalProps {
  leadId: number;
  history: AlertHistoryEntry[];
  onClose: () => void;
}

export function AlertHistoryModal({ history, onClose }: AlertHistoryModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-card border border-glass-border bg-surface shadow-lg">
        <div className="flex items-center justify-between border-b border-glass-border px-5 py-4">
          <h3 className="font-heading text-heading-sm">
            Histórico de Alertas
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded-button text-muted hover:text-foreground hover:bg-surface-secondary transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[400px] overflow-y-auto p-4">
          {history.length === 0 ? (
            <p className="text-body-md text-muted text-center py-4">
              Nenhum histórico encontrado.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {history.map((entry, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-3 rounded-button border border-glass-border bg-surface-secondary px-4 py-3"
                >
                  <Clock className="h-4 w-4 text-muted flex-shrink-0" />
                  <div className="flex flex-col min-w-0">
                    <span className="text-body-md font-medium text-foreground">
                      {entry.type}
                    </span>
                    <span className="text-body-sm text-muted">
                      Arquivado em {entry.date}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
