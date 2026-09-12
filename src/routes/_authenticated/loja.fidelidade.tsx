import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Flame,
  Gift,
  Minus,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  ShoppingBag,
  Ticket,
  Trash2,
  Trophy,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  addExistingCustomerToLoyalty,
  adjustLoyaltyMarks,
  cancelLoyaltyRewardAdmin,
  getLoyaltyAdminData,
  issueManualLoyaltyReward,
  saveLoyaltyAdminConfig,
  setLoyaltyParticipantActive,
  setProductLoyaltyEligible,
  updateLoyaltyParticipant,
} from "@/lib/loyalty.functions";

export const Route = createFileRoute("/_authenticated/loja/fidelidade")({
  component: LoyaltyAdminPage,
});

type Section = "participants" | "rewards" | "rules";

function brDate(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      });
}

function participantName(account: any) {
  return (
    account?.profile?.full_name ||
    account?.profile?.email ||
    account?.profile?.phone ||
    "Cliente sem nome"
  );
}

function LoyaltyAdminPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [required, setRequired] = useState("10");
  const [enabled, setEnabled] = useState(true);
  const [section, setSection] = useState<Section>("participants");
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [editing, setEditing] = useState<any>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [addingCustomer, setAddingCustomer] = useState(false);
  const [addCustomerSearch, setAddCustomerSearch] = useState("");
  const [manualReason, setManualReason] = useState<Record<string, string>>({});

  async function token() {
    return (await supabase.auth.getSession()).data.session?.access_token || null;
  }

  async function load() {
    setLoading(true);
    const result = await getLoyaltyAdminData({
      data: { accessToken: await token() },
    });

    if (!result.ok) {
      toast.error((result as any).error || "Falha ao carregar fidelidade");
    } else {
      setData(result);
      setRequired(String(result.config.required));
      setEnabled(result.config.enabled);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  const accounts = data?.accounts || [];
  const rewards = data?.rewards || [];
  const ledger = data?.ledger || [];

  const availableRewards = useMemo(
    () => rewards.filter((r: any) => r.status === "available").length,
    [rewards],
  );

  const redeemedRewards = useMemo(
    () => rewards.filter((r: any) => r.status === "redeemed").length,
    [rewards],
  );

  const activeAccounts = useMemo(
    () => accounts.filter((a: any) => a.active !== false),
    [accounts],
  );

  const filteredAccounts = useMemo(() => {
    const q = search.trim().toLowerCase();

    return accounts.filter((a: any) => {
      if (!showInactive && a.active === false) return false;
      if (!q) return true;

      return [
        a.profile?.full_name,
        a.profile?.email,
        a.profile?.phone,
        a.user_id,
      ].some((value) =>
        String(value || "")
          .toLowerCase()
          .includes(q),
      );
    });
  }, [accounts, search, showInactive]);

  const filteredProfiles = useMemo(() => {
    const q = addCustomerSearch.trim().toLowerCase();
    return (data?.availableProfiles || [])
      .filter((p: any) => {
        if (!q) return true;
        return [p.full_name, p.email, p.phone].some((value) =>
          String(value || "")
            .toLowerCase()
            .includes(q),
        );
      })
      .slice(0, 30);
  }, [data, addCustomerSearch]);

  async function saveConfig() {
    const result = await saveLoyaltyAdminConfig({
      data: {
        accessToken: await token(),
        enabled,
        required: Number(required),
      },
    });

    if (!result.ok)
      return toast.error((result as any).error || "Falha ao salvar");

    toast.success("Regras do Clube HotBox atualizadas.");
    void load();
  }

  async function toggleProduct(id: string, value: boolean) {
    setData((current: any) => ({
      ...current,
      products: current.products.map((p: any) =>
        p.id === id ? { ...p, loyalty_eligible: value } : p,
      ),
    }));

    const result = await setProductLoyaltyEligible({
      data: {
        accessToken: await token(),
        productId: id,
        eligible: value,
      },
    });

    if (!result.ok) {
      toast.error((result as any).error || "Falha ao atualizar produto");
      void load();
    }
  }

  function openEdit(account: any) {
    setEditing({
      userId: account.user_id,
      fullName: account.profile?.full_name || "",
      email: account.profile?.email || "",
      phone: account.profile?.phone || "",
      points: Number(account.points || 0),
      lifetimeOrders: Number(account.lifetime_qualifying_orders || 0),
      adminNotes: account.admin_notes || "",
      reason: "",
    });
  }

  async function saveParticipant() {
    if (!editing || savingEdit) return;
    setSavingEdit(true);

    try {
      const result = await updateLoyaltyParticipant({
        data: {
          accessToken: await token(),
          userId: editing.userId,
          fullName: editing.fullName,
          email: editing.email,
          phone: editing.phone,
          points: Number(editing.points),
          lifetimeOrders: Number(editing.lifetimeOrders),
          adminNotes: editing.adminNotes,
          reason: editing.reason,
        },
      });

      if (!result.ok)
        throw new Error((result as any).error || "Falha ao salvar participante");

      toast.success(
        (result as any).sync?.rewards_created
          ? `Dados salvos e ${(result as any).sync.rewards_created} recompensa(s) liberada(s).`
          : "Dados do participante atualizados.",
      );
      setEditing(null);
      await load();
    } catch (error: any) {
      toast.error(error?.message || "Não foi possível salvar");
    } finally {
      setSavingEdit(false);
    }
  }

  async function adjustMarks(
    account: any,
    delta: number,
    countAsPurchase = true,
  ) {
    const reason =
      manualReason[account.user_id]?.trim() ||
      (delta > 0
        ? "Ajuste manual de fidelidade"
        : "Correção manual de fidelidade");

    const result = await adjustLoyaltyMarks({
      data: {
        accessToken: await token(),
        userId: account.user_id,
        delta,
        countAsPurchase,
        reason,
      },
    });

    if (!result.ok)
      return toast.error((result as any).error || "Falha ao ajustar marcações");

    setManualReason((current) => ({
      ...current,
      [account.user_id]: "",
    }));

    const created = Number((result as any).sync?.rewards_created || 0);
    toast.success(
      created > 0
        ? `Marcação ajustada e ${created} recompensa(s) liberada(s)!`
        : "Marcação ajustada.",
    );
    await load();
  }

  async function issueReward(account: any) {
    const reason =
      manualReason[account.user_id]?.trim() ||
      "Recompensa concedida manualmente pela loja";

    if (
      !window.confirm(
        `Liberar uma batata grátis manualmente para ${participantName(account)}?`,
      )
    )
      return;

    const result = await issueManualLoyaltyReward({
      data: {
        accessToken: await token(),
        userId: account.user_id,
        reason,
      },
    });

    if (!result.ok)
      return toast.error((result as any).error || "Falha ao liberar recompensa");

    toast.success("Recompensa liberada manualmente.");
    await load();
  }

  async function removeParticipant(account: any) {
    if (
      !window.confirm(
        `Remover ${participantName(account)} do Clube HotBox?\n\nO histórico será preservado, mas cupons ainda não usados serão cancelados.`,
      )
    )
      return;

    const result = await setLoyaltyParticipantActive({
      data: {
        accessToken: await token(),
        userId: account.user_id,
        active: false,
        reason: manualReason[account.user_id] || "Removido manualmente do Clube HotBox",
      },
    });

    if (!result.ok)
      return toast.error((result as any).error || "Falha ao remover participante");

    toast.success("Participante removido do Clube. O histórico foi preservado.");
    await load();
  }

  async function reactivateParticipant(account: any) {
    const result = await setLoyaltyParticipantActive({
      data: {
        accessToken: await token(),
        userId: account.user_id,
        active: true,
        reason: "Participação reativada manualmente",
      },
    });

    if (!result.ok)
      return toast.error((result as any).error || "Falha ao reativar participante");

    toast.success("Participante reativado.");
    await load();
  }

  async function addExistingCustomer(profile: any) {
    const result = await addExistingCustomerToLoyalty({
      data: {
        accessToken: await token(),
        userId: profile.user_id,
        initialPoints: 0,
        initialLifetimeOrders: 0,
        notes: "Participante adicionado manualmente pela loja",
      },
    });

    if (!result.ok)
      return toast.error((result as any).error || "Falha ao adicionar participante");

    toast.success("Cliente adicionado ao Clube HotBox.");
    setAddingCustomer(false);
    setAddCustomerSearch("");
    await load();
  }

  async function cancelReward(reward: any) {
    if (
      !window.confirm(
        `Cancelar o cupom ${reward.code}?\n\nO cliente não poderá mais usar esta recompensa.`,
      )
    )
      return;

    const result = await cancelLoyaltyRewardAdmin({
      data: {
        accessToken: await token(),
        rewardId: reward.id,
        reason: "Recompensa cancelada manualmente pela loja",
      },
    });

    if (!result.ok)
      return toast.error((result as any).error || "Falha ao cancelar recompensa");

    toast.success("Recompensa cancelada.");
    await load();
  }

  function rewardsFor(userId: string) {
    return rewards.filter((r: any) => r.user_id === userId);
  }

  function ledgerFor(userId: string) {
    return ledger.filter((l: any) => l.user_id === userId).slice(0, 12);
  }

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-black">
            <Flame className="size-6 text-orange-500" /> Clube HotBox
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Controle automático e manual da fidelidade em um só lugar.
          </p>
        </div>

        <Button variant="outline" onClick={load} disabled={loading}>
          <RefreshCw
            className={`mr-2 size-4 ${loading ? "animate-spin" : ""}`}
          />
          Atualizar
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4">
          <Users className="size-5 text-primary" />
          <p className="mt-2 text-xs font-bold uppercase text-muted-foreground">
            Participantes ativos
          </p>
          <p className="text-3xl font-black">{activeAccounts.length}</p>
        </Card>

        <Card className="p-4">
          <ShoppingBag className="size-5 text-blue-600" />
          <p className="mt-2 text-xs font-bold uppercase text-muted-foreground">
            Compras válidas
          </p>
          <p className="text-3xl font-black">
            {accounts.reduce(
              (sum: number, a: any) =>
                sum + Number(a.lifetime_qualifying_orders || 0),
              0,
            )}
          </p>
        </Card>

        <Card className="p-4">
          <Gift className="size-5 text-emerald-600" />
          <p className="mt-2 text-xs font-bold uppercase text-muted-foreground">
            Recompensas disponíveis
          </p>
          <p className="text-3xl font-black">{availableRewards}</p>
        </Card>

        <Card className="p-4">
          <Trophy className="size-5 text-amber-500" />
          <p className="mt-2 text-xs font-bold uppercase text-muted-foreground">
            Recompensas usadas
          </p>
          <p className="text-3xl font-black">{redeemedRewards}</p>
        </Card>
      </div>

      <Card className="p-2">
        <div className="grid gap-2 sm:grid-cols-3">
          <Button
            variant={section === "participants" ? "default" : "ghost"}
            onClick={() => setSection("participants")}
            className="justify-start"
          >
            <Users className="mr-2 size-4" />
            Participantes
          </Button>
          <Button
            variant={section === "rewards" ? "default" : "ghost"}
            onClick={() => setSection("rewards")}
            className="justify-start"
          >
            <Ticket className="mr-2 size-4" />
            Recompensas
          </Button>
          <Button
            variant={section === "rules" ? "default" : "ghost"}
            onClick={() => setSection("rules")}
            className="justify-start"
          >
            <Settings2 className="mr-2 size-4" />
            Regras e produtos
          </Button>
        </div>
      </Card>

      {section === "participants" && (
        <>
          <Card className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-black">Participantes do Clube</h2>
                <p className="text-xs text-muted-foreground">
                  Edite marcações, número de compras, dados do cliente e
                  recompensas manualmente.
                </p>
              </div>

              <Button onClick={() => setAddingCustomer(true)}>
                <UserPlus className="mr-2 size-4" />
                Adicionar cliente
              </Button>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <div className="relative min-w-[240px] flex-1">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Buscar por nome, telefone ou e-mail"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <label className="flex items-center gap-2 rounded-xl border px-3 text-xs font-semibold">
                <Switch
                  checked={showInactive}
                  onCheckedChange={setShowInactive}
                />
                Mostrar removidos
              </label>
            </div>
          </Card>

          <div className="space-y-3">
            {filteredAccounts.length === 0 ? (
              <Card className="p-8 text-center text-sm text-muted-foreground">
                Nenhum participante encontrado.
              </Card>
            ) : (
              filteredAccounts.map((account: any) => {
                const isExpanded = expandedUser === account.user_id;
                const requiredCount = Number(data?.config?.required || 10);
                const points = Number(account.points || 0);
                const progress = Math.min(
                  100,
                  Math.round((points / requiredCount) * 100),
                );
                const accountRewards = rewardsFor(account.user_id);
                const available = accountRewards.filter(
                  (r: any) => r.status === "available",
                ).length;

                return (
                  <Card
                    key={account.user_id}
                    className={`overflow-hidden ${
                      account.active === false ? "opacity-65" : ""
                    }`}
                  >
                    <div className="p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-black">
                              {participantName(account)}
                            </h3>

                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                account.active === false
                                  ? "bg-zinc-200 text-zinc-700"
                                  : "bg-emerald-100 text-emerald-700"
                              }`}
                            >
                              {account.active === false
                                ? "Removido do Clube"
                                : "Participante ativo"}
                            </span>

                            {available > 0 && (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                                {available} recompensa(s) disponível(is)
                              </span>
                            )}
                          </div>

                          <p className="mt-1 text-xs text-muted-foreground">
                            {account.profile?.phone || "Sem telefone"} ·{" "}
                            {account.profile?.email || "Sem e-mail"}
                          </p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {account.active !== false ? (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => adjustMarks(account, 1, true)}
                              >
                                <Plus className="mr-1 size-3.5" /> +1 marcação
                              </Button>

                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openEdit(account)}
                              >
                                <Pencil className="mr-1 size-3.5" /> Editar
                              </Button>
                            </>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => reactivateParticipant(account)}
                            >
                              <RotateCcw className="mr-1 size-3.5" /> Reativar
                            </Button>
                          )}

                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setExpandedUser(
                                isExpanded ? null : account.user_id,
                              )
                            }
                          >
                            {isExpanded ? (
                              <ChevronUp className="size-4" />
                            ) : (
                              <ChevronDown className="size-4" />
                            )}
                          </Button>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-4">
                        <div className="rounded-xl border p-3">
                          <p className="text-[10px] font-bold uppercase text-muted-foreground">
                            Marcações atuais
                          </p>
                          <p className="mt-1 text-xl font-black">
                            {points}/{requiredCount}
                          </p>
                          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                        </div>

                        <div className="rounded-xl border p-3">
                          <p className="text-[10px] font-bold uppercase text-muted-foreground">
                            Compras que já contaram
                          </p>
                          <p className="mt-1 text-xl font-black">
                            {account.lifetime_qualifying_orders || 0}
                          </p>
                        </div>

                        <div className="rounded-xl border p-3">
                          <p className="text-[10px] font-bold uppercase text-muted-foreground">
                            Prêmios liberados
                          </p>
                          <p className="mt-1 text-xl font-black">
                            {account.rewards_earned || 0}
                          </p>
                        </div>

                        <div className="rounded-xl border p-3">
                          <p className="text-[10px] font-bold uppercase text-muted-foreground">
                            Prêmios usados
                          </p>
                          <p className="mt-1 text-xl font-black">
                            {account.rewards_redeemed || 0}
                          </p>
                        </div>
                      </div>

                      {account.admin_notes && (
                        <div className="mt-3 rounded-xl bg-muted/50 px-3 py-2 text-xs">
                          <b>Anotação interna:</b> {account.admin_notes}
                        </div>
                      )}
                    </div>

                    {isExpanded && (
                      <div className="border-t bg-muted/15 p-4">
                        <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
                          <div>
                            <h4 className="font-black">Controle manual</h4>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Toda alteração manual fica registrada no histórico.
                            </p>

                            <Input
                              className="mt-3"
                              placeholder="Motivo opcional da alteração"
                              value={manualReason[account.user_id] || ""}
                              onChange={(e) =>
                                setManualReason((current) => ({
                                  ...current,
                                  [account.user_id]: e.target.value,
                                }))
                              }
                            />

                            <div className="mt-3 flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={account.active === false}
                                onClick={() => adjustMarks(account, 1, true)}
                              >
                                <Plus className="mr-1 size-3.5" />
                                +1 marcação e compra
                              </Button>

                              <Button
                                size="sm"
                                variant="outline"
                                disabled={account.active === false}
                                onClick={() => adjustMarks(account, -1, true)}
                              >
                                <Minus className="mr-1 size-3.5" />
                                -1 marcação e compra
                              </Button>

                              <Button
                                size="sm"
                                variant="outline"
                                disabled={account.active === false}
                                onClick={() => adjustMarks(account, 1, false)}
                              >
                                <Plus className="mr-1 size-3.5" />
                                +1 só marcação
                              </Button>

                              <Button
                                size="sm"
                                className="bg-amber-500 text-black hover:bg-amber-400"
                                disabled={account.active === false}
                                onClick={() => issueReward(account)}
                              >
                                <Gift className="mr-1 size-3.5" />
                                Dar batata grátis
                              </Button>

                              <Button
                                size="sm"
                                variant="outline"
                                disabled={account.active === false}
                                onClick={() => openEdit(account)}
                              >
                                <Pencil className="mr-1 size-3.5" />
                                Editar números e dados
                              </Button>

                              {account.active !== false && (
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => removeParticipant(account)}
                                >
                                  <Trash2 className="mr-1 size-3.5" />
                                  Remover do Clube
                                </Button>
                              )}
                            </div>
                          </div>

                          <div>
                            <h4 className="font-black">Últimas movimentações</h4>
                            <div className="mt-3 max-h-52 space-y-2 overflow-auto">
                              {ledgerFor(account.user_id).length === 0 ? (
                                <p className="text-xs text-muted-foreground">
                                  Sem movimentações registradas.
                                </p>
                              ) : (
                                ledgerFor(account.user_id).map((row: any) => (
                                  <div
                                    key={row.id}
                                    className="rounded-lg border bg-background px-3 py-2 text-xs"
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <b>
                                        {row.event_type === "order_completed"
                                          ? "Compra contabilizada"
                                          : row.event_type === "reward_issued"
                                            ? "Recompensa liberada"
                                            : row.event_type === "reward_redeemed"
                                              ? "Recompensa usada"
                                              : "Ajuste manual"}
                                      </b>
                                      <span className="text-muted-foreground">
                                        {brDate(row.created_at)}
                                      </span>
                                    </div>
                                    <p className="mt-1 text-muted-foreground">
                                      {row.description || "Sem observação"}
                                      {Number(row.points_delta || 0) !== 0
                                        ? ` · ${Number(row.points_delta) > 0 ? "+" : ""}${row.points_delta} marcação(ões)`
                                        : ""}
                                    </p>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </Card>
                );
              })
            )}
          </div>
        </>
      )}

      {section === "rewards" && (
        <Card className="overflow-hidden p-0">
          <div className="border-b p-5">
            <h2 className="font-black">Recompensas e cupons do Clube</h2>
            <p className="text-xs text-muted-foreground">
              Veja cupons disponíveis, utilizados ou cancelados e cancele
              manualmente quando necessário.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-sm">
              <thead>
                <tr className="border-b bg-muted/30 text-left text-xs uppercase text-muted-foreground">
                  <th className="p-3">Cliente</th>
                  <th className="p-3">Cupom</th>
                  <th className="p-3">Situação</th>
                  <th className="p-3">Liberado em</th>
                  <th className="p-3">Usado em</th>
                  <th className="p-3 text-right">Ação</th>
                </tr>
              </thead>
              <tbody>
                {rewards.map((reward: any) => {
                  const account = accounts.find(
                    (a: any) => a.user_id === reward.user_id,
                  );

                  const statusLabel =
                    reward.status === "available"
                      ? "Disponível"
                      : reward.status === "reserved"
                        ? "Reservado em compra"
                        : reward.status === "redeemed"
                          ? "Usado"
                          : "Cancelado";

                  return (
                    <tr key={reward.id} className="border-b last:border-0">
                      <td className="p-3">
                        <b>{participantName(account)}</b>
                      </td>
                      <td className="p-3 font-mono font-bold">{reward.code}</td>
                      <td className="p-3">{statusLabel}</td>
                      <td className="p-3">{brDate(reward.earned_at)}</td>
                      <td className="p-3">{brDate(reward.redeemed_at)}</td>
                      <td className="p-3 text-right">
                        {["available", "reserved"].includes(reward.status) && (
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => cancelReward(reward)}
                          >
                            Cancelar
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {section === "rules" && (
        <div className="space-y-5">
          <Card className="p-5">
            <h2 className="font-black">Regras gerais do Clube</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Essas regras continuam valendo para a contagem automática.
            </p>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="flex items-center justify-between rounded-xl border p-3">
                <div>
                  <p className="font-bold">Programa ativo</p>
                  <p className="text-xs text-muted-foreground">
                    Desative para pausar novas contagens automáticas.
                  </p>
                </div>
                <Switch checked={enabled} onCheckedChange={setEnabled} />
              </label>

              <div>
                <label className="text-xs font-bold">
                  Compras para ganhar 1 batata
                </label>
                <Input
                  className="mt-1"
                  type="number"
                  min={1}
                  max={50}
                  value={required}
                  onChange={(e) => setRequired(e.target.value)}
                />
              </div>
            </div>

            <Button className="mt-4" onClick={saveConfig}>
              <Check className="mr-2 size-4" />
              Salvar regras
            </Button>
          </Card>

          <Card className="overflow-hidden p-0">
            <div className="border-b p-5">
              <h2 className="font-black">Produtos que podem ficar grátis</h2>
              <p className="text-xs text-muted-foreground">
                Marque somente os produtos que podem ser usados como prêmio.
              </p>
            </div>

            <div className="divide-y">
              {(data?.products || []).map((product: any) => (
                <div
                  key={product.id}
                  className="flex items-center justify-between gap-3 px-5 py-3"
                >
                  <div>
                    <p className="font-semibold">{product.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {product.category || product.kind || "Sem categoria"}
                      {product.active === false ? " · produto inativo" : ""}
                    </p>
                  </div>

                  <Switch
                    checked={product.loyalty_eligible === true}
                    onCheckedChange={(value) =>
                      toggleProduct(product.id, value)
                    }
                  />
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-black/50 p-4">
          <Card className="max-h-[90vh] w-full max-w-2xl overflow-auto p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-black">Editar participante</h2>
                <p className="text-xs text-muted-foreground">
                  Você pode corrigir dados e também definir manualmente as
                  marcações e compras válidas.
                </p>
              </div>

              <Button
                size="icon"
                variant="ghost"
                onClick={() => setEditing(null)}
              >
                <X className="size-4" />
              </Button>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs font-bold">Nome</label>
                <Input
                  className="mt-1"
                  value={editing.fullName}
                  onChange={(e) =>
                    setEditing((current: any) => ({
                      ...current,
                      fullName: e.target.value,
                    }))
                  }
                />
              </div>

              <div>
                <label className="text-xs font-bold">Telefone</label>
                <Input
                  className="mt-1"
                  value={editing.phone}
                  onChange={(e) =>
                    setEditing((current: any) => ({
                      ...current,
                      phone: e.target.value,
                    }))
                  }
                />
              </div>

              <div className="sm:col-span-2">
                <label className="text-xs font-bold">E-mail</label>
                <Input
                  className="mt-1"
                  value={editing.email}
                  onChange={(e) =>
                    setEditing((current: any) => ({
                      ...current,
                      email: e.target.value,
                    }))
                  }
                />
              </div>

              <div>
                <label className="text-xs font-bold">
                  Marcações atuais
                </label>
                <Input
                  className="mt-1"
                  type="number"
                  min={0}
                  value={editing.points}
                  onChange={(e) =>
                    setEditing((current: any) => ({
                      ...current,
                      points: e.target.value,
                    }))
                  }
                />
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Se atingir a meta, o sistema libera automaticamente a
                  recompensa e deixa o restante das marcações.
                </p>
              </div>

              <div>
                <label className="text-xs font-bold">
                  Total de compras válidas
                </label>
                <Input
                  className="mt-1"
                  type="number"
                  min={0}
                  value={editing.lifetimeOrders}
                  onChange={(e) =>
                    setEditing((current: any) => ({
                      ...current,
                      lifetimeOrders: e.target.value,
                    }))
                  }
                />
              </div>

              <div className="sm:col-span-2">
                <label className="text-xs font-bold">
                  Anotação interna sobre este cliente
                </label>
                <textarea
                  className="mt-1 min-h-20 w-full rounded-xl border bg-background px-3 py-2 text-sm"
                  value={editing.adminNotes}
                  onChange={(e) =>
                    setEditing((current: any) => ({
                      ...current,
                      adminNotes: e.target.value,
                    }))
                  }
                  placeholder="Ex.: cliente antigo, ajuste feito por compra presencial..."
                />
              </div>

              <div className="sm:col-span-2">
                <label className="text-xs font-bold">
                  Motivo desta alteração
                </label>
                <Input
                  className="mt-1"
                  value={editing.reason}
                  onChange={(e) =>
                    setEditing((current: any) => ({
                      ...current,
                      reason: e.target.value,
                    }))
                  }
                  placeholder="Ex.: corrigindo 2 compras que não entraram na contagem"
                />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditing(null)}>
                Cancelar
              </Button>
              <Button onClick={saveParticipant} disabled={savingEdit}>
                {savingEdit ? "Salvando..." : "Salvar alterações"}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {addingCustomer && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-black/50 p-4">
          <Card className="max-h-[85vh] w-full max-w-xl overflow-auto p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-black">
                  Adicionar cliente ao Clube
                </h2>
                <p className="text-xs text-muted-foreground">
                  Escolha um cliente que já tenha uma conta no cardápio digital.
                </p>
              </div>

              <Button
                size="icon"
                variant="ghost"
                onClick={() => setAddingCustomer(false)}
              >
                <X className="size-4" />
              </Button>
            </div>

            <div className="relative mt-4">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Buscar cliente por nome, telefone ou e-mail"
                value={addCustomerSearch}
                onChange={(e) => setAddCustomerSearch(e.target.value)}
              />
            </div>

            <div className="mt-3 divide-y rounded-xl border">
              {filteredProfiles.length === 0 ? (
                <p className="p-5 text-center text-sm text-muted-foreground">
                  Não há clientes disponíveis para adicionar.
                </p>
              ) : (
                filteredProfiles.map((profile: any) => (
                  <div
                    key={profile.user_id}
                    className="flex items-center justify-between gap-3 p-3"
                  >
                    <div>
                      <p className="font-bold">
                        {profile.full_name || profile.email || "Cliente"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {profile.phone || "Sem telefone"} ·{" "}
                        {profile.email || "Sem e-mail"}
                      </p>
                    </div>

                    <Button
                      size="sm"
                      onClick={() => addExistingCustomer(profile)}
                    >
                      Adicionar
                    </Button>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      )}

      {!loading && accounts.length > 0 && (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          Remover um participante não apaga a conta de login nem o histórico de
          pedidos. A participação no Clube é desativada e recompensas ainda não
          usadas são canceladas.
        </p>
      )}
    </div>
  );
}
