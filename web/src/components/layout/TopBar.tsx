import { Menu } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useSidebarStore } from '@/stores/sidebarStore';

export function TopBar() {
  const user = useAuthStore((s) => s.user);
  const openMobile = useSidebarStore((s) => s.openMobile);
  const initial = user?.name?.charAt(0).toUpperCase() || '?';

  return (
    <header className="flex h-14 items-center justify-between border-b border-glass-border bg-surface px-4 md:px-6">
      <div className="flex items-center gap-3">
        <button
          onClick={openMobile}
          className="flex items-center justify-center rounded-button p-2 text-muted hover:bg-surface-secondary hover:text-foreground transition-colors md:hidden cursor-pointer"
          aria-label="Abrir menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <span className="text-body-md text-muted">
          Ola, <span className="font-heading font-semibold text-[#E0E3E9]">{user?.name || 'Usuario'}</span>
        </span>
      </div>
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary to-accent-blue font-heading text-body-md font-semibold text-white">
        {initial}
      </div>
    </header>
  );
}
