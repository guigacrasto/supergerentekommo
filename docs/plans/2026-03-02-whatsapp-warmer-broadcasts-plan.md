# WhatsApp Warmer + Broadcasts Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add two CRUD screens — number warming management and broadcast campaign management — with Supabase backend and React frontend.

**Architecture:** Pure CRUD with Supabase tables, Express routes behind `requireAuth`, and React pages. Admin users see all data and can approve/manage campaigns. No WhatsApp API integration — external platform handles actual messaging.

**Tech Stack:** TypeScript, Express, Supabase (PostgreSQL), React 18, Tailwind CSS v4, lucide-react, CVA badges

**Design doc:** `docs/plans/2026-03-02-whatsapp-warmer-broadcasts-design.md`

---

### Task 1: Create Supabase Tables

**Context:** Run these SQL statements in the Supabase SQL Editor (Dashboard > SQL Editor). These create the 3 tables needed for both features.

**Step 1: Run SQL to create `warming_numbers` table**

```sql
CREATE TABLE warming_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  phone text NOT NULL,
  label text,
  status text NOT NULL DEFAULT 'warming' CHECK (status IN ('warming', 'ready', 'paused')),
  days_active int NOT NULL DEFAULT 0,
  daily_limit int NOT NULL DEFAULT 50,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_warming_numbers_user ON warming_numbers(user_id);
```

**Step 2: Run SQL to create `campaigns` table**

```sql
CREATE TABLE campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  template_name text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'sent')),
  total_recipients int NOT NULL DEFAULT 0,
  approved_by uuid REFERENCES profiles(id),
  approved_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_campaigns_user ON campaigns(user_id);
CREATE INDEX idx_campaigns_status ON campaigns(status);
```

**Step 3: Run SQL to create `campaign_recipients` table**

```sql
CREATE TABLE campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  phone text NOT NULL,
  name text,
  variables jsonb
);

CREATE INDEX idx_campaign_recipients_campaign ON campaign_recipients(campaign_id);
```

**Step 4: Verify tables exist**

In Supabase Dashboard > Table Editor, confirm all 3 tables appear: `warming_numbers`, `campaigns`, `campaign_recipients`.

---

### Task 2: Backend — Warmer Routes

**Files:**
- Create: `src/api/routes/warmer.ts`

**Step 1: Create the warmer router file**

Create `src/api/routes/warmer.ts` with this content:

```typescript
import { Router } from "express";
import { supabase } from "../supabase.js";
import { requireAuth, AuthRequest } from "../middleware/requireAuth.js";

export function warmerRouter(): Router {
  const router = Router();
  router.use(requireAuth as any);

  // GET /api/warmer — list numbers (admin sees all, user sees own)
  router.get("/", async (req: AuthRequest, res) => {
    let query = supabase
      .from("warming_numbers")
      .select("*, profiles!inner(name, email)")
      .order("created_at", { ascending: false });

    if (req.userRole !== "admin") {
      query = query.eq("user_id", req.userId!);
    }

    const { data, error } = await query;
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json(data);
  });

  // GET /api/warmer/export — CSV export
  router.get("/export", async (req: AuthRequest, res) => {
    let query = supabase
      .from("warming_numbers")
      .select("phone, label, status, days_active, daily_limit, created_at, profiles!inner(name)")
      .order("created_at", { ascending: false });

    if (req.userRole !== "admin") {
      query = query.eq("user_id", req.userId!);
    }

    const { data, error } = await query;
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    const header = "Telefone,Apelido,Status,Dias Ativo,Limite/dia,Criado por,Criado em";
    const rows = (data || []).map((r: any) =>
      [r.phone, r.label || "", r.status, r.days_active, r.daily_limit, r.profiles?.name || "", r.created_at].join(",")
    );
    const csv = [header, ...rows].join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=aquecimento-numeros.csv");
    res.send(csv);
  });

  // POST /api/warmer — create number
  router.post("/", async (req: AuthRequest, res) => {
    const { phone, label, daily_limit } = req.body;
    if (!phone) {
      res.status(400).json({ error: "Telefone é obrigatório." });
      return;
    }

    const { data, error } = await supabase
      .from("warming_numbers")
      .insert({
        user_id: req.userId!,
        phone,
        label: label || null,
        daily_limit: daily_limit || 50,
      })
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(201).json(data);
  });

  // PATCH /api/warmer/:id — update status/label/limit
  router.patch("/:id", async (req: AuthRequest, res) => {
    const { id } = req.params;
    const { status, label, daily_limit } = req.body;

    const updateData: Record<string, unknown> = {};
    if (status !== undefined) updateData.status = status;
    if (label !== undefined) updateData.label = label;
    if (daily_limit !== undefined) updateData.daily_limit = daily_limit;

    if (Object.keys(updateData).length === 0) {
      res.status(400).json({ error: "Nenhum campo para atualizar." });
      return;
    }

    let query = supabase
      .from("warming_numbers")
      .update(updateData)
      .eq("id", id);

    // Non-admin can only update own numbers
    if (req.userRole !== "admin") {
      query = query.eq("user_id", req.userId!);
    }

    const { error } = await query;
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ message: "Número atualizado." });
  });

  // DELETE /api/warmer/:id — remove number
  router.delete("/:id", async (req: AuthRequest, res) => {
    const { id } = req.params;

    let query = supabase
      .from("warming_numbers")
      .delete()
      .eq("id", id);

    if (req.userRole !== "admin") {
      query = query.eq("user_id", req.userId!);
    }

    const { error } = await query;
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ message: "Número removido." });
  });

  return router;
}
```

**Step 2: Verify the file compiles**

Run: `npx tsc --noEmit src/api/routes/warmer.ts`
Expected: No errors

**Step 3: Commit**

```bash
git add src/api/routes/warmer.ts
git commit -m "feat(warmer): add backend CRUD routes for warming numbers"
```

---

### Task 3: Backend — Broadcasts Routes

**Files:**
- Create: `src/api/routes/broadcasts.ts`

**Step 1: Create the broadcasts router file**

Create `src/api/routes/broadcasts.ts` with this content:

```typescript
import { Router } from "express";
import { supabase } from "../supabase.js";
import { requireAuth, AuthRequest } from "../middleware/requireAuth.js";

export function broadcastsRouter(): Router {
  const router = Router();
  router.use(requireAuth as any);

  // GET /api/broadcasts — list campaigns (admin sees all, user sees own)
  router.get("/", async (req: AuthRequest, res) => {
    let query = supabase
      .from("campaigns")
      .select("*, profiles!campaigns_user_id_fkey(name, email)")
      .order("created_at", { ascending: false });

    if (req.userRole !== "admin") {
      query = query.eq("user_id", req.userId!);
    }

    const { data, error } = await query;
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json(data);
  });

  // POST /api/broadcasts — create campaign
  router.post("/", async (req: AuthRequest, res) => {
    const { name, template_name } = req.body;
    if (!name) {
      res.status(400).json({ error: "Nome da campanha é obrigatório." });
      return;
    }

    const { data, error } = await supabase
      .from("campaigns")
      .insert({
        user_id: req.userId!,
        name,
        template_name: template_name || null,
      })
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(201).json(data);
  });

  // POST /api/broadcasts/:id/recipients — upload recipients (JSON array from CSV parse on frontend)
  router.post("/:id/recipients", async (req: AuthRequest, res) => {
    const { id } = req.params;
    const { recipients } = req.body; // Array of { phone, name?, variables? }

    if (!Array.isArray(recipients) || recipients.length === 0) {
      res.status(400).json({ error: "Lista de destinatários vazia." });
      return;
    }

    // Verify campaign belongs to user (or is admin)
    const { data: campaign } = await supabase
      .from("campaigns")
      .select("id, user_id")
      .eq("id", id)
      .single();

    if (!campaign) {
      res.status(404).json({ error: "Campanha não encontrada." });
      return;
    }
    if (req.userRole !== "admin" && campaign.user_id !== req.userId) {
      res.status(403).json({ error: "Sem permissão." });
      return;
    }

    const rows = recipients.map((r: { phone: string; name?: string; variables?: Record<string, unknown> }) => ({
      campaign_id: id,
      phone: r.phone,
      name: r.name || null,
      variables: r.variables || null,
    }));

    const { error: insertError } = await supabase
      .from("campaign_recipients")
      .insert(rows);

    if (insertError) {
      res.status(500).json({ error: insertError.message });
      return;
    }

    // Update total_recipients count
    const { count } = await supabase
      .from("campaign_recipients")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", id);

    await supabase
      .from("campaigns")
      .update({ total_recipients: count || 0 })
      .eq("id", id);

    res.json({ message: `${rows.length} destinatários adicionados.`, total: count });
  });

  // GET /api/broadcasts/:id/recipients — list recipients
  router.get("/:id/recipients", async (req: AuthRequest, res) => {
    const { id } = req.params;

    // Verify access
    const { data: campaign } = await supabase
      .from("campaigns")
      .select("id, user_id")
      .eq("id", id)
      .single();

    if (!campaign) {
      res.status(404).json({ error: "Campanha não encontrada." });
      return;
    }
    if (req.userRole !== "admin" && campaign.user_id !== req.userId) {
      res.status(403).json({ error: "Sem permissão." });
      return;
    }

    const { data, error } = await supabase
      .from("campaign_recipients")
      .select("id, phone, name, variables")
      .eq("campaign_id", id)
      .order("name", { ascending: true });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json(data);
  });

  // PATCH /api/broadcasts/:id/approve — admin approves campaign
  router.patch("/:id/approve", async (req: AuthRequest, res) => {
    if (req.userRole !== "admin") {
      res.status(403).json({ error: "Apenas administradores podem aprovar campanhas." });
      return;
    }

    const { id } = req.params;
    const { error } = await supabase
      .from("campaigns")
      .update({
        status: "approved",
        approved_by: req.userId!,
        approved_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "pending");

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ message: "Campanha aprovada." });
  });

  // PATCH /api/broadcasts/:id/sent — admin marks as sent
  router.patch("/:id/sent", async (req: AuthRequest, res) => {
    if (req.userRole !== "admin") {
      res.status(403).json({ error: "Apenas administradores podem marcar como enviado." });
      return;
    }

    const { id } = req.params;
    const { error } = await supabase
      .from("campaigns")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "approved");

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ message: "Campanha marcada como enviada." });
  });

  // DELETE /api/broadcasts/:id — delete campaign (only if pending)
  router.delete("/:id", async (req: AuthRequest, res) => {
    const { id } = req.params;

    // Verify ownership and status
    const { data: campaign } = await supabase
      .from("campaigns")
      .select("id, user_id, status")
      .eq("id", id)
      .single();

    if (!campaign) {
      res.status(404).json({ error: "Campanha não encontrada." });
      return;
    }
    if (req.userRole !== "admin" && campaign.user_id !== req.userId) {
      res.status(403).json({ error: "Sem permissão." });
      return;
    }
    if (campaign.status !== "pending") {
      res.status(400).json({ error: "Só é possível excluir campanhas pendentes." });
      return;
    }

    // Delete recipients first (cascade should handle, but be explicit)
    await supabase.from("campaign_recipients").delete().eq("campaign_id", id);

    const { error } = await supabase.from("campaigns").delete().eq("id", id);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ message: "Campanha excluída." });
  });

  return router;
}
```

**Step 2: Verify the file compiles**

Run: `npx tsc --noEmit src/api/routes/broadcasts.ts`
Expected: No errors

**Step 3: Commit**

```bash
git add src/api/routes/broadcasts.ts
git commit -m "feat(broadcasts): add backend CRUD routes for campaigns"
```

---

### Task 4: Backend — Register Routes in Server

**Files:**
- Modify: `src/api/server.ts` (lines ~1-14 imports, ~27-35 route registration)

**Step 1: Add imports to `src/api/server.ts`**

After the existing import of `insightsRouter`, add:

```typescript
import { warmerRouter } from "./routes/warmer.js";
import { broadcastsRouter } from "./routes/broadcasts.js";
```

**Step 2: Register routes in `createServer()`**

After the line `app.use("/api/admin", adminRouter());`, add:

```typescript
app.use("/api/warmer", warmerRouter());
app.use("/api/broadcasts", broadcastsRouter());
```

**Step 3: Verify build**

Run: `npm run build`
Expected: No errors

**Step 4: Commit**

```bash
git add src/api/server.ts
git commit -m "feat: register warmer and broadcasts routes in server"
```

---

### Task 5: Frontend — Types

**Files:**
- Modify: `web/src/types/index.ts`

**Step 1: Add types at the end of `web/src/types/index.ts`**

```typescript
// Warming Numbers
export interface WarmingNumber {
  id: string;
  user_id: string;
  phone: string;
  label: string | null;
  status: 'warming' | 'ready' | 'paused';
  days_active: number;
  daily_limit: number;
  created_at: string;
  profiles?: { name: string; email: string };
}

// Campaigns (Broadcasts)
export type CampaignStatus = 'pending' | 'approved' | 'sent';

export interface Campaign {
  id: string;
  user_id: string;
  name: string;
  template_name: string | null;
  status: CampaignStatus;
  total_recipients: number;
  approved_by: string | null;
  approved_at: string | null;
  sent_at: string | null;
  created_at: string;
  profiles?: { name: string; email: string };
}

export interface CampaignRecipient {
  id: string;
  phone: string;
  name: string | null;
  variables: Record<string, unknown> | null;
}
```

**Step 2: Commit**

```bash
git add web/src/types/index.ts
git commit -m "feat: add WarmingNumber, Campaign, CampaignRecipient types"
```

---

### Task 6: Frontend — Warmer Page + Components

**Files:**
- Create: `web/src/components/features/warmer/WarmerTable.tsx`
- Create: `web/src/components/features/warmer/WarmerForm.tsx`
- Create: `web/src/pages/WarmerPage.tsx`

**Step 1: Create `web/src/components/features/warmer/WarmerTable.tsx`**

```tsx
import { Pencil, Trash2 } from 'lucide-react';
import { Card, Badge, Button } from '@/components/ui';
import type { WarmingNumber } from '@/types';

interface WarmerTableProps {
  numbers: WarmingNumber[];
  isAdmin: boolean;
  onEdit: (num: WarmingNumber) => void;
  onDelete: (id: string) => void;
}

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'danger'> = {
  warming: 'warning',
  ready: 'success',
  paused: 'danger',
};

const STATUS_LABEL: Record<string, string> = {
  warming: 'Aquecendo',
  ready: 'Pronto',
  paused: 'Pausado',
};

export function WarmerTable({ numbers, isAdmin, onEdit, onDelete }: WarmerTableProps) {
  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-body-md">
          <thead>
            <tr className="border-b border-glass-border text-left">
              <th className="px-5 py-3 font-heading font-semibold">Telefone</th>
              <th className="px-5 py-3 font-heading font-semibold">Apelido</th>
              <th className="px-5 py-3 font-heading font-semibold">Status</th>
              <th className="px-5 py-3 font-heading font-semibold">Dias Ativo</th>
              <th className="px-5 py-3 font-heading font-semibold">Limite/dia</th>
              {isAdmin && <th className="px-5 py-3 font-heading font-semibold">Criado por</th>}
              <th className="px-5 py-3 font-heading font-semibold">Ações</th>
            </tr>
          </thead>
          <tbody>
            {numbers.map((num) => (
              <tr key={num.id} className="border-b border-glass-border/50 last:border-0">
                <td className="px-5 py-3 font-mono">{num.phone}</td>
                <td className="px-5 py-3 text-muted">{num.label || '—'}</td>
                <td className="px-5 py-3">
                  <Badge variant={STATUS_VARIANT[num.status]}>
                    {STATUS_LABEL[num.status]}
                  </Badge>
                </td>
                <td className="px-5 py-3">{num.days_active}</td>
                <td className="px-5 py-3">{num.daily_limit}</td>
                {isAdmin && (
                  <td className="px-5 py-3 text-muted">{num.profiles?.name || '—'}</td>
                )}
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => onEdit(num)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => onDelete(num.id)}>
                      <Trash2 className="h-4 w-4 text-danger" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
```

**Step 2: Create `web/src/components/features/warmer/WarmerForm.tsx`**

```tsx
import { useState } from 'react';
import { Button, Input, Card, CardHeader, CardTitle } from '@/components/ui';
import type { WarmingNumber } from '@/types';

interface WarmerFormProps {
  editing?: WarmingNumber | null;
  onSave: (data: { phone: string; label: string; daily_limit: number }) => void;
  onCancel: () => void;
}

export function WarmerForm({ editing, onSave, onCancel }: WarmerFormProps) {
  const [phone, setPhone] = useState(editing?.phone || '');
  const [label, setLabel] = useState(editing?.label || '');
  const [dailyLimit, setDailyLimit] = useState(String(editing?.daily_limit || 50));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      phone: phone.trim(),
      label: label.trim(),
      daily_limit: parseInt(dailyLimit, 10) || 50,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{editing ? 'Editar Número' : 'Novo Número'}</CardTitle>
      </CardHeader>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-5">
        <Input
          label="Telefone"
          placeholder="+5511999999999"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
          disabled={!!editing}
        />
        <Input
          label="Apelido"
          placeholder="Ex: Chip 1"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <Input
          label="Limite diário de mensagens"
          type="number"
          placeholder="50"
          value={dailyLimit}
          onChange={(e) => setDailyLimit(e.target.value)}
        />
        <div className="flex gap-3 justify-end">
          <Button variant="ghost" type="button" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit">
            {editing ? 'Salvar' : 'Cadastrar'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
```

**Step 3: Create `web/src/pages/WarmerPage.tsx`**

```tsx
import { useEffect, useState, useCallback } from 'react';
import { Flame, Plus, Download } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { PageSpinner, EmptyState, Button, Chip } from '@/components/ui';
import { KPICard } from '@/components/features/dashboard/KPICard';
import { WarmerTable } from '@/components/features/warmer/WarmerTable';
import { WarmerForm } from '@/components/features/warmer/WarmerForm';
import type { WarmingNumber } from '@/types';

export function WarmerPage() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';

  const [numbers, setNumbers] = useState<WarmingNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<WarmingNumber | null>(null);
  const [viewAll, setViewAll] = useState(false);

  const fetchNumbers = useCallback(async () => {
    try {
      const res = await api.get<WarmingNumber[]>('/warmer');
      setNumbers(res.data);
    } catch (err) {
      console.error('[WarmerPage] Erro ao carregar:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNumbers();
  }, [fetchNumbers]);

  const handleSave = async (data: { phone: string; label: string; daily_limit: number }) => {
    try {
      if (editing) {
        await api.patch(`/warmer/${editing.id}`, {
          label: data.label,
          daily_limit: data.daily_limit,
        });
      } else {
        await api.post('/warmer', data);
      }
      setShowForm(false);
      setEditing(null);
      fetchNumbers();
    } catch (err) {
      console.error('[WarmerPage] Erro ao salvar:', err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remover este número?')) return;
    try {
      await api.delete(`/warmer/${id}`);
      fetchNumbers();
    } catch (err) {
      console.error('[WarmerPage] Erro ao remover:', err);
    }
  };

  const handleExport = () => {
    window.open('/api/warmer/export', '_blank');
  };

  if (loading) return <PageSpinner />;

  // Filter view for admin
  const displayed = isAdmin && !viewAll
    ? numbers.filter((n) => n.user_id === user?.id)
    : numbers;

  const warming = displayed.filter((n) => n.status === 'warming').length;
  const ready = displayed.filter((n) => n.status === 'ready').length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-heading-lg">Aquecedor de Número</h1>
        <div className="flex gap-3">
          <Button variant="ghost" onClick={handleExport}>
            <Download className="h-4 w-4" />
            Exportar CSV
          </Button>
          <Button onClick={() => { setEditing(null); setShowForm(true); }}>
            <Plus className="h-4 w-4" />
            Novo Número
          </Button>
        </div>
      </div>

      {/* Admin filter toggle */}
      {isAdmin && (
        <div className="flex gap-2">
          <Chip active={!viewAll} onClick={() => setViewAll(false)}>Meus</Chip>
          <Chip active={viewAll} onClick={() => setViewAll(true)}>Todos</Chip>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KPICard label="Total" value={displayed.length} />
        <KPICard label="Aquecendo" value={warming} />
        <KPICard label="Prontos" value={ready} />
      </div>

      {showForm && (
        <WarmerForm
          editing={editing}
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditing(null); }}
        />
      )}

      {displayed.length === 0 ? (
        <EmptyState
          icon={Flame}
          title="Nenhum número cadastrado"
          description="Cadastre números para iniciar o aquecimento."
        />
      ) : (
        <WarmerTable
          numbers={displayed}
          isAdmin={isAdmin}
          onEdit={(num) => { setEditing(num); setShowForm(true); }}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
```

**Step 4: Commit**

```bash
git add web/src/components/features/warmer/ web/src/pages/WarmerPage.tsx
git commit -m "feat(warmer): add WarmerPage with table, form, KPIs, and CSV export"
```

---

### Task 7: Frontend — Broadcasts Page + Components

**Files:**
- Create: `web/src/components/features/broadcasts/CampaignTable.tsx`
- Create: `web/src/components/features/broadcasts/CampaignForm.tsx`
- Create: `web/src/components/features/broadcasts/RecipientUpload.tsx`
- Create: `web/src/pages/BroadcastsPage.tsx`

**Step 1: Create `web/src/components/features/broadcasts/CampaignTable.tsx`**

```tsx
import { useState } from 'react';
import { ChevronDown, ChevronRight, CheckCircle2, Send, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, Badge, Button } from '@/components/ui';
import { RecipientUpload } from './RecipientUpload';
import type { Campaign, CampaignRecipient } from '@/types';

interface CampaignTableProps {
  campaigns: Campaign[];
  isAdmin: boolean;
  onRefresh: () => void;
}

const STATUS_VARIANT: Record<string, 'warning' | 'info' | 'success'> = {
  pending: 'warning',
  approved: 'info',
  sent: 'success',
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pendente',
  approved: 'Aprovado',
  sent: 'Enviado',
};

export function CampaignTable({ campaigns, isAdmin, onRefresh }: CampaignTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [recipients, setRecipients] = useState<CampaignRecipient[]>([]);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  const toggleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setRecipients([]);
      return;
    }
    setExpandedId(id);
    try {
      const res = await api.get<CampaignRecipient[]>(`/broadcasts/${id}/recipients`);
      setRecipients(res.data);
    } catch (err) {
      console.error('[CampaignTable] Erro ao carregar destinatários:', err);
      setRecipients([]);
    }
  };

  const handleApprove = async (id: string) => {
    setLoadingAction(id);
    try {
      await api.patch(`/broadcasts/${id}/approve`);
      onRefresh();
    } catch (err) {
      console.error('[CampaignTable] Erro ao aprovar:', err);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleMarkSent = async (id: string) => {
    setLoadingAction(id);
    try {
      await api.patch(`/broadcasts/${id}/sent`);
      onRefresh();
    } catch (err) {
      console.error('[CampaignTable] Erro ao marcar enviado:', err);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir esta campanha?')) return;
    setLoadingAction(id);
    try {
      await api.delete(`/broadcasts/${id}`);
      onRefresh();
    } catch (err) {
      console.error('[CampaignTable] Erro ao excluir:', err);
    } finally {
      setLoadingAction(null);
    }
  };

  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-body-md">
          <thead>
            <tr className="border-b border-glass-border text-left">
              <th className="px-5 py-3 w-8" />
              <th className="px-5 py-3 font-heading font-semibold">Campanha</th>
              <th className="px-5 py-3 font-heading font-semibold">Template</th>
              <th className="px-5 py-3 font-heading font-semibold">Destinatários</th>
              <th className="px-5 py-3 font-heading font-semibold">Status</th>
              {isAdmin && <th className="px-5 py-3 font-heading font-semibold">Criado por</th>}
              <th className="px-5 py-3 font-heading font-semibold">Data</th>
              <th className="px-5 py-3 font-heading font-semibold">Ações</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => (
              <>
                <tr key={c.id} className="border-b border-glass-border/50 cursor-pointer hover:bg-white/5" onClick={() => toggleExpand(c.id)}>
                  <td className="px-5 py-3">
                    {expandedId === c.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </td>
                  <td className="px-5 py-3 font-heading font-medium">{c.name}</td>
                  <td className="px-5 py-3 text-muted">{c.template_name || '—'}</td>
                  <td className="px-5 py-3">{c.total_recipients}</td>
                  <td className="px-5 py-3">
                    <Badge variant={STATUS_VARIANT[c.status] as any}>
                      {STATUS_LABEL[c.status]}
                    </Badge>
                  </td>
                  {isAdmin && <td className="px-5 py-3 text-muted">{c.profiles?.name || '—'}</td>}
                  <td className="px-5 py-3 text-muted">
                    {new Date(c.created_at).toLocaleDateString('pt-BR')}
                  </td>
                  <td className="px-5 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-2">
                      {isAdmin && c.status === 'pending' && (
                        <Button
                          variant="success"
                          size="sm"
                          loading={loadingAction === c.id}
                          onClick={() => handleApprove(c.id)}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          Aprovar
                        </Button>
                      )}
                      {isAdmin && c.status === 'approved' && (
                        <Button
                          size="sm"
                          loading={loadingAction === c.id}
                          onClick={() => handleMarkSent(c.id)}
                        >
                          <Send className="h-4 w-4" />
                          Enviado
                        </Button>
                      )}
                      {c.status === 'pending' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={loadingAction === c.id}
                          onClick={() => handleDelete(c.id)}
                        >
                          <Trash2 className="h-4 w-4 text-danger" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
                {expandedId === c.id && (
                  <tr key={`${c.id}-expanded`}>
                    <td colSpan={isAdmin ? 8 : 7} className="px-5 py-4 bg-surface-elevated/50">
                      <div className="flex flex-col gap-4">
                        {c.status === 'pending' && (
                          <RecipientUpload campaignId={c.id} onUploaded={() => { onRefresh(); toggleExpand(c.id); }} />
                        )}
                        {recipients.length === 0 ? (
                          <p className="text-muted text-body-sm">Nenhum destinatário adicionado.</p>
                        ) : (
                          <div className="max-h-60 overflow-y-auto">
                            <table className="w-full text-body-sm">
                              <thead>
                                <tr className="text-left text-muted">
                                  <th className="px-3 py-1">Telefone</th>
                                  <th className="px-3 py-1">Nome</th>
                                </tr>
                              </thead>
                              <tbody>
                                {recipients.map((r) => (
                                  <tr key={r.id} className="border-t border-glass-border/30">
                                    <td className="px-3 py-1 font-mono">{r.phone}</td>
                                    <td className="px-3 py-1">{r.name || '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
```

**Step 2: Create `web/src/components/features/broadcasts/CampaignForm.tsx`**

```tsx
import { useState } from 'react';
import { Button, Input, Card, CardHeader, CardTitle } from '@/components/ui';

interface CampaignFormProps {
  onSave: (data: { name: string; template_name: string }) => void;
  onCancel: () => void;
}

export function CampaignForm({ onSave, onCancel }: CampaignFormProps) {
  const [name, setName] = useState('');
  const [templateName, setTemplateName] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ name: name.trim(), template_name: templateName.trim() });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nova Campanha</CardTitle>
      </CardHeader>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-5">
        <Input
          label="Nome da campanha"
          placeholder="Ex: Black Friday 2026"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <Input
          label="Nome do template Meta"
          placeholder="Ex: promo_oferta_especial"
          value={templateName}
          onChange={(e) => setTemplateName(e.target.value)}
        />
        <div className="flex gap-3 justify-end">
          <Button variant="ghost" type="button" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit">Criar Campanha</Button>
        </div>
      </form>
    </Card>
  );
}
```

**Step 3: Create `web/src/components/features/broadcasts/RecipientUpload.tsx`**

```tsx
import { useState, useRef } from 'react';
import { Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui';

interface RecipientUploadProps {
  campaignId: string;
  onUploaded: () => void;
}

function parseCSV(text: string): Array<{ phone: string; name?: string }> {
  const lines = text.trim().split('\n');
  if (lines.length === 0) return [];

  // Detect header
  const firstLine = lines[0].toLowerCase();
  const hasHeader = firstLine.includes('phone') || firstLine.includes('telefone') || firstLine.includes('nome');
  const dataLines = hasHeader ? lines.slice(1) : lines;

  return dataLines
    .map((line) => {
      const cols = line.split(/[,;\t]/).map((c) => c.trim().replace(/^["']|["']$/g, ''));
      return { phone: cols[0], name: cols[1] || undefined };
    })
    .filter((r) => r.phone && r.phone.length > 5);
}

export function RecipientUpload({ campaignId, onUploaded }: RecipientUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<Array<{ phone: string; name?: string }>>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseCSV(reader.result as string);
      setPreview(parsed);
    };
    reader.readAsText(file);
  };

  const handleUpload = async () => {
    if (preview.length === 0) return;
    setUploading(true);
    try {
      await api.post(`/broadcasts/${campaignId}/recipients`, { recipients: preview });
      setPreview([]);
      if (fileRef.current) fileRef.current.value = '';
      onUploaded();
    } catch (err) {
      console.error('[RecipientUpload] Erro:', err);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.txt"
          onChange={handleFile}
          className="text-body-sm text-muted file:mr-3 file:rounded-button file:border-0 file:bg-primary/20 file:px-3 file:py-1.5 file:text-body-sm file:text-white file:cursor-pointer"
        />
        {preview.length > 0 && (
          <Button size="sm" loading={uploading} onClick={handleUpload}>
            <Upload className="h-4 w-4" />
            Enviar {preview.length} destinatários
          </Button>
        )}
      </div>
      {preview.length > 0 && (
        <p className="text-body-sm text-muted">
          Preview: {preview.slice(0, 3).map((r) => r.phone).join(', ')}
          {preview.length > 3 && ` e mais ${preview.length - 3}...`}
        </p>
      )}
    </div>
  );
}
```

**Step 4: Create `web/src/pages/BroadcastsPage.tsx`**

```tsx
import { useEffect, useState, useCallback } from 'react';
import { Megaphone, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { PageSpinner, EmptyState, Button, Chip } from '@/components/ui';
import { KPICard } from '@/components/features/dashboard/KPICard';
import { CampaignTable } from '@/components/features/broadcasts/CampaignTable';
import { CampaignForm } from '@/components/features/broadcasts/CampaignForm';
import type { Campaign } from '@/types';

export function BroadcastsPage() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [viewAll, setViewAll] = useState(false);

  const fetchCampaigns = useCallback(async () => {
    try {
      const res = await api.get<Campaign[]>('/broadcasts');
      setCampaigns(res.data);
    } catch (err) {
      console.error('[BroadcastsPage] Erro ao carregar:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  const handleCreate = async (data: { name: string; template_name: string }) => {
    try {
      await api.post('/broadcasts', data);
      setShowForm(false);
      fetchCampaigns();
    } catch (err) {
      console.error('[BroadcastsPage] Erro ao criar:', err);
    }
  };

  if (loading) return <PageSpinner />;

  const displayed = isAdmin && !viewAll
    ? campaigns.filter((c) => c.user_id === user?.id)
    : campaigns;

  const pending = displayed.filter((c) => c.status === 'pending').length;
  const approved = displayed.filter((c) => c.status === 'approved').length;
  const sent = displayed.filter((c) => c.status === 'sent').length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-heading-lg">Disparos</h1>
        <Button onClick={() => setShowForm(true)}>
          <Plus className="h-4 w-4" />
          Nova Campanha
        </Button>
      </div>

      {/* Admin filter toggle */}
      {isAdmin && (
        <div className="flex gap-2">
          <Chip active={!viewAll} onClick={() => setViewAll(false)}>Meus</Chip>
          <Chip active={viewAll} onClick={() => setViewAll(true)}>Todos</Chip>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <KPICard label="Total" value={displayed.length} />
        <KPICard label="Pendentes" value={pending} />
        <KPICard label="Aprovadas" value={approved} />
        <KPICard label="Enviadas" value={sent} />
      </div>

      {showForm && (
        <CampaignForm onSave={handleCreate} onCancel={() => setShowForm(false)} />
      )}

      {displayed.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="Nenhuma campanha"
          description="Crie uma campanha para disparos em massa."
        />
      ) : (
        <CampaignTable
          campaigns={displayed}
          isAdmin={isAdmin}
          onRefresh={fetchCampaigns}
        />
      )}
    </div>
  );
}
```

**Step 5: Commit**

```bash
git add web/src/components/features/broadcasts/ web/src/pages/BroadcastsPage.tsx
git commit -m "feat(broadcasts): add BroadcastsPage with campaign table, form, CSV upload"
```

---

### Task 8: Frontend — Routing + Sidebar

**Files:**
- Modify: `web/src/components/layout/Sidebar.tsx` (~lines 5-7 imports, ~lines 23-29 NAV_ITEMS)
- Modify: `web/src/App.tsx` (~lines 1-12 imports, ~lines 31-35 Routes)

**Step 1: Add icons to Sidebar imports**

In `web/src/components/layout/Sidebar.tsx`, add `Flame` and `Megaphone` to the lucide-react import:

```typescript
import {
  PieChart,
  MessageSquare,
  BarChart3,
  AlertTriangle,
  Brain,
  Flame,
  Megaphone,
  LogOut,
  Settings,
  ChevronRight,
  ChevronLeft,
} from 'lucide-react';
```

**Step 2: Add items to NAV_ITEMS**

Add these two entries to the `NAV_ITEMS` array, after the `insights` entry:

```typescript
{ to: '/warmer', label: 'Aquecedor', icon: Flame },
{ to: '/broadcasts', label: 'Disparos', icon: Megaphone },
```

**Step 3: Add page imports to App.tsx**

In `web/src/App.tsx`, add:

```typescript
import { WarmerPage } from '@/pages/WarmerPage';
import { BroadcastsPage } from '@/pages/BroadcastsPage';
```

**Step 4: Add Routes in App.tsx**

Inside the `<Route element={<AppShell />}>` block, after the insights route and before the admin route, add:

```tsx
<Route path="/warmer" element={<WarmerPage />} />
<Route path="/broadcasts" element={<BroadcastsPage />} />
```

**Step 5: Build and verify**

Run: `npm run build:all`
Expected: Build succeeds with no errors

**Step 6: Commit**

```bash
git add web/src/components/layout/Sidebar.tsx web/src/App.tsx
git commit -m "feat: add Warmer and Broadcasts to sidebar and routing"
```

---

### Task 9: Final Build + Smoke Test

**Step 1: Full build**

Run: `npm run build:all`
Expected: No errors

**Step 2: Start server locally**

Run: `npm start` (or `npm run dev`)
Expected: Server starts, health returns 200

**Step 3: Verify routes respond**

```bash
# These should return 401 (no auth token) — which confirms the routes exist
curl -s http://localhost:3000/api/warmer | grep -q "Token"
curl -s http://localhost:3000/api/broadcasts | grep -q "Token"
```

**Step 4: Final commit if any fixes needed**

If any fixes were required, commit them:

```bash
git add -A
git commit -m "fix: address build issues in warmer/broadcasts features"
```
