"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  type BetStatus,
  type HistoryBet,
  type HistoryBetLeg,
  type LegStatus,
  countLegHits,
  formatSignedCLP,
} from "@/lib/history-tracker";
import { formatLegMatchStatus } from "@/lib/result-checker";
import {
  formatExplicitBetLine,
  getExplicitPickLabel,
} from "@/lib/formatters";
import { computePerformanceMetrics } from "@/lib/stats";
import { resolveStrategyMode } from "@/lib/parlay-defaults";
import { cn, formatCLP, formatOdds, formatPercent } from "@/lib/utils";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleSlash,
  Clock,
  Percent,
  Search,
  TrendingUp,
  Trash2,
  Wallet,
  X,
  XCircle,
} from "lucide-react";
import {
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type StatusFilter = "ALL" | "WON" | "LOST" | "PENDING";
export type ModeFilter = "ALL" | "MONOPOLY_ASYMMETRY" | "SINGLE_SAFE" | "LOTTERY";
export type SortBy = "date" | "odds" | "stake" | "profit";
export type SortOrder = "desc" | "asc";
export type PageSize = 10 | 25 | 50;

const PAGE_SIZE_OPTIONS: PageSize[] = [10, 25, 50];

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "ALL", label: "Todos" },
  { value: "WON", label: "Ganadas (WON)" },
  { value: "LOST", label: "Perdidas (LOST)" },
  { value: "PENDING", label: "Pendientes (PENDING)" },
];

const MODE_OPTIONS: { value: ModeFilter; label: string }[] = [
  { value: "ALL", label: "Todos" },
  { value: "MONOPOLY_ASYMMETRY", label: "Asimetría" },
  { value: "SINGLE_SAFE", label: "Picks Seguros" },
  { value: "LOTTERY", label: "Lotería" },
];

type SortPreset = `${SortBy}_${SortOrder}`;

const SORT_OPTIONS: { value: SortPreset; label: string }[] = [
  { value: "date_desc", label: "Más recientes primero" },
  { value: "date_asc", label: "Más antiguos primero" },
  { value: "odds_desc", label: "Cuota más alta" },
  { value: "profit_desc", label: "Mayor ganancia/pérdida" },
];

const selectClassName =
  "min-h-11 w-full rounded-xl border border-slate-500 bg-slate-950 px-3 text-sm text-slate-50 [color-scheme:dark] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950";

function ticketProfit(bet: HistoryBet): number {
  if (bet.status === "won") return bet.potentialReturn - bet.stakeCLP;
  if (bet.status === "lost") return -bet.stakeCLP;
  return 0;
}

function betTimestamp(bet: HistoryBet): number {
  const created = Date.parse(bet.createdAt);
  if (Number.isFinite(created)) return created;
  const day = Date.parse(`${bet.date}T00:00:00`);
  return Number.isFinite(day) ? day : 0;
}

function betModeKey(bet: HistoryBet): Exclude<ModeFilter, "ALL"> {
  const resolved = resolveStrategyMode(bet.strategyMode);
  if (resolved === "monopoly-asymmetry") return "MONOPOLY_ASYMMETRY";
  if (resolved === "daily-safe") return "SINGLE_SAFE";
  return "LOTTERY";
}

function statusMatches(status: BetStatus, filter: StatusFilter): boolean {
  if (filter === "ALL") return true;
  if (filter === "WON") return status === "won";
  if (filter === "LOST") return status === "lost";
  return status === "pending";
}

function betMatchesSearch(bet: HistoryBet, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (bet.id.toLowerCase().includes(q)) return true;
  return bet.legs.some((leg) => {
    const haystacks = [
      leg.homeTeam,
      leg.awayTeam,
      leg.matchLabel,
      leg.leagueName,
    ];
    return haystacks.some((value) => (value ?? "").toLowerCase().includes(q));
  });
}

function compareBets(
  a: HistoryBet,
  b: HistoryBet,
  sortBy: SortBy,
  sortOrder: SortOrder
): number {
  let delta = 0;
  if (sortBy === "odds") delta = a.totalOdds - b.totalOdds;
  else if (sortBy === "stake") delta = a.stakeCLP - b.stakeCLP;
  else if (sortBy === "profit") delta = ticketProfit(a) - ticketProfit(b);
  else delta = betTimestamp(a) - betTimestamp(b);

  if (delta === 0) delta = betTimestamp(a) - betTimestamp(b);
  return sortOrder === "asc" ? delta : -delta;
}

function pageItems(current: number, total: number): Array<number | "ellipsis"> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const items: Array<number | "ellipsis"> = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);

  if (start > 2) items.push("ellipsis");
  for (let page = start; page <= end; page += 1) items.push(page);
  if (end < total - 1) items.push("ellipsis");
  items.push(total);
  return items;
}

export function BetHistory({
  bets,
  removingIds,
  onDelete,
}: {
  bets: HistoryBet[];
  removingIds: Set<string>;
  onDelete: (betId: string) => void;
}) {
  const searchId = useId();
  const statusId = useId();
  const modeId = useId();
  const sortId = useId();
  const pageSizeId = useId();

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(10);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [modeFilter, setModeFilter] = useState<ModeFilter>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("date");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const pendingCount = useMemo(
    () => bets.filter((bet) => bet.status === "pending").length,
    [bets]
  );

  const filteredBets = useMemo(() => {
    return bets.filter((bet) => {
      if (!statusMatches(bet.status, statusFilter)) return false;
      if (modeFilter !== "ALL" && betModeKey(bet) !== modeFilter) return false;
      return betMatchesSearch(bet, searchQuery);
    });
  }, [bets, statusFilter, modeFilter, searchQuery]);

  const sortedBets = useMemo(() => {
    return [...filteredBets].sort((a, b) =>
      compareBets(a, b, sortBy, sortOrder)
    );
  }, [filteredBets, sortBy, sortOrder]);

  const kpis = useMemo(() => {
    const totalJugado = filteredBets.reduce(
      (sum, bet) => sum + (bet.stakeCLP > 0 ? bet.stakeCLP : 0),
      0
    );
    const perf = computePerformanceMetrics(
      filteredBets.map((bet) => ({
        status: bet.status,
        stake: bet.stakeCLP,
        payout: bet.potentialReturn,
      }))
    );
    return {
      totalJugado,
      roi: perf.roi,
      winRate: perf.winRate,
      settled: perf.settled,
      count: filteredBets.length,
    };
  }, [filteredBets]);

  const totalPages = Math.max(1, Math.ceil(sortedBets.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  if (currentPage !== safePage) {
    setCurrentPage(safePage);
  }

  const pagedBets = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return sortedBets.slice(start, start + pageSize);
  }, [sortedBets, safePage, pageSize]);

  const rangeStart =
    sortedBets.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const rangeEnd = Math.min(safePage * pageSize, sortedBets.length);

  const sortPreset: SortPreset = `${sortBy}_${sortOrder}`;
  const filtersActive =
    statusFilter !== "ALL" ||
    modeFilter !== "ALL" ||
    searchQuery.trim().length > 0;

  function resetToFirstPage() {
    setCurrentPage(1);
  }

  function handleSortChange(value: string) {
    const [nextBy, nextOrder] = value.split("_") as [SortBy, SortOrder];
    setSortBy(nextBy);
    setSortOrder(nextOrder);
    resetToFirstPage();
  }

  function clearFilters() {
    setStatusFilter("ALL");
    setModeFilter("ALL");
    setSearchQuery("");
    setSortBy("date");
    setSortOrder("desc");
    setCurrentPage(1);
  }

  return (
    <Card className="border-sky-500/30 bg-sky-950/15">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>Historial de apuestas</CardTitle>
          {pendingCount > 0 ? (
            <Badge variant="info" className="gap-1">
              <Clock className="h-3 w-3 text-sky-400" aria-hidden />
              {pendingCount} en curso
            </Badge>
          ) : null}
          <Badge variant="default">{bets.length} boletos</Badge>
        </div>
        <CardDescription>
          Busca, filtra y pagina tus combinadas. Win Rate % y ROI se calculan
          solo con boletos liquidados del conjunto filtrado. Los pendientes no
          entran en esos indicadores.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-3">
          <KpiBadge
            icon={<Wallet className="h-3.5 w-3.5 text-sky-300" aria-hidden />}
            label="Total jugado"
            value={formatCLP(kpis.totalJugado)}
            hint="Suma de stakes del filtro"
          />
          <KpiBadge
            icon={
              <TrendingUp
                className={cn(
                  "h-3.5 w-3.5",
                  kpis.roi >= 0 ? "text-emerald-300" : "text-rose-300"
                )}
                aria-hidden
              />
            }
            label="Rendimiento (ROI %)"
            value={
              kpis.settled > 0
                ? `${kpis.roi >= 0 ? "+" : ""}${kpis.roi.toFixed(1)}%`
                : "—"
            }
            valueClass={
              kpis.settled === 0
                ? "text-slate-300"
                : kpis.roi >= 0
                  ? "text-emerald-200"
                  : "text-rose-200"
            }
            hint="Net profit / stake liquidado"
          />
          <KpiBadge
            icon={<Percent className="h-3.5 w-3.5 text-emerald-300" aria-hidden />}
            label="Win Rate %"
            value={kpis.settled > 0 ? formatPercent(kpis.winRate) : "—"}
            hint="Ganadas / (ganadas + perdidas)"
          />
        </div>

        <div
          role="search"
          className="flex flex-col gap-3 rounded-xl border border-slate-600/70 bg-slate-950/40 p-3 sm:p-4"
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label htmlFor={searchId}>Buscar</Label>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  aria-hidden
                />
                <Input
                  id={searchId}
                  type="search"
                  value={searchQuery}
                  onChange={(event) => {
                    setSearchQuery(event.target.value);
                    resetToFirstPage();
                  }}
                  placeholder="Buscar equipo, liga o ticket..."
                  className="pl-9"
                  autoComplete="off"
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 lg:w-[min(100%,42rem)]">
              <div className="space-y-1.5">
                <Label htmlFor={statusId}>Estado</Label>
                <select
                  id={statusId}
                  className={selectClassName}
                  value={statusFilter}
                  onChange={(event) => {
                    setStatusFilter(event.target.value as StatusFilter);
                    resetToFirstPage();
                  }}
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={modeId}>Modo</Label>
                <select
                  id={modeId}
                  className={selectClassName}
                  value={modeFilter}
                  onChange={(event) => {
                    setModeFilter(event.target.value as ModeFilter);
                    resetToFirstPage();
                  }}
                >
                  {MODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={sortId}>Orden</Label>
                <select
                  id={sortId}
                  className={selectClassName}
                  value={SORT_OPTIONS.some((option) => option.value === sortPreset)
                    ? sortPreset
                    : "date_desc"}
                  onChange={(event) => handleSortChange(event.target.value)}
                >
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {filtersActive ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-slate-300">
                {kpis.count} resultado{kpis.count === 1 ? "" : "s"} con los
                filtros actuales
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearFilters}
              >
                Limpiar filtros
              </Button>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <p
            className="text-sm text-slate-300"
            aria-live="polite"
          >
            {sortedBets.length === 0
              ? "Mostrando 0 de 0 apuestas"
              : `Mostrando ${rangeStart}-${rangeEnd} de ${sortedBets.length} apuestas`}
          </p>

          <nav
            className="flex flex-wrap items-center justify-center gap-1"
            aria-label="Paginación del historial"
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11"
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              disabled={safePage <= 1}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
              Anterior
            </Button>
            {pageItems(safePage, totalPages).map((item, index) =>
              item === "ellipsis" ? (
                <span
                  key={`ellipsis-${index}`}
                  className="min-w-9 px-1 text-center text-sm text-slate-400"
                >
                  …
                </span>
              ) : (
                <Button
                  key={item}
                  type="button"
                  variant={item === safePage ? "secondary" : "ghost"}
                  size="sm"
                  className="min-h-11 min-w-11"
                  aria-label={`Ir a la página ${item}`}
                  aria-current={item === safePage ? "page" : undefined}
                  onClick={() => setCurrentPage(item)}
                >
                  {item}
                </Button>
              )
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11"
              onClick={() =>
                setCurrentPage((page) => Math.min(totalPages, page + 1))
              }
              disabled={safePage >= totalPages}
            >
              Siguiente
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
          </nav>

          <div className="flex items-center justify-end gap-2">
            <Label htmlFor={pageSizeId} className="whitespace-nowrap">
              Por página
            </Label>
            <select
              id={pageSizeId}
              className={cn(selectClassName, "w-auto min-w-[7.5rem]")}
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value) as PageSize);
                resetToFirstPage();
              }}
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size} / pág
                </option>
              ))}
            </select>
          </div>
        </div>

        <div
          className="space-y-3"
          aria-live="polite"
          aria-atomic="false"
        >
          {pagedBets.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-600 px-4 py-10 text-center text-sm text-slate-300">
              No hay apuestas que coincidan con la búsqueda o los filtros.
            </p>
          ) : (
            pagedBets.map((bet) => (
              <BetRow
                key={bet.id}
                bet={bet}
                removing={removingIds.has(bet.id)}
                onDelete={() => onDelete(bet.id)}
              />
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function KpiBadge({
  icon,
  label,
  value,
  hint,
  valueClass,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-600/70 bg-slate-950/50 px-3 py-2.5">
      <p className="inline-flex items-center gap-1.5 text-xs text-slate-300">
        {icon}
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 text-lg font-semibold tabular-nums text-slate-50",
          valueClass
        )}
      >
        {value}
      </p>
      <p className="text-xs leading-snug text-slate-400">{hint}</p>
    </div>
  );
}

function ticketStatusBadge(status: BetStatus): {
  variant: "success" | "danger" | "warning" | "info";
  label: ReactNode;
} {
  if (status === "won") {
    return {
      variant: "success",
      label: (
        <span className="inline-flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3 text-emerald-400" />
          Ganada
        </span>
      ),
    };
  }
  if (status === "lost") {
    return {
      variant: "danger",
      label: (
        <span className="inline-flex items-center gap-1">
          <XCircle className="h-3 w-3 text-rose-400" />
          Perdida
        </span>
      ),
    };
  }
  if (status === "void") {
    return {
      variant: "warning",
      label: (
        <span className="inline-flex items-center gap-1">
          <CircleSlash className="h-3 w-3 text-amber-300" />
          Cancelada
        </span>
      ),
    };
  }
  return {
    variant: "info",
    label: (
      <span className="inline-flex items-center gap-1">
        <Clock className="h-3 w-3 text-sky-400" />
        En juego
      </span>
    ),
  };
}

function LegHitsInline({
  hits,
  className,
}: {
  hits: { won: number; lost: number; pending: number; voided?: number };
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs",
        className
      )}
    >
      <span className="inline-flex items-center gap-0.5 text-emerald-200">
        <Check className="h-3 w-3" strokeWidth={2.5} />
        {hits.won}
      </span>
      <span className="inline-flex items-center gap-0.5 text-rose-200">
        <X className="h-3 w-3" strokeWidth={2.5} />
        {hits.lost}
      </span>
      <span className="inline-flex items-center gap-0.5 text-sky-200">
        <Clock className="h-3 w-3" />
        {hits.pending}
      </span>
      {(hits.voided ?? 0) > 0 ? (
        <span className="inline-flex items-center gap-0.5 text-amber-300">
          <CircleSlash className="h-3 w-3" />
          {hits.voided}
        </span>
      ) : null}
    </span>
  );
}

function legHitsBadgeVariant(
  betStatus: BetStatus
): "success" | "danger" | "warning" | "info" {
  if (betStatus === "won") return "success";
  if (betStatus === "lost") return "danger";
  if (betStatus === "void") return "warning";
  return "info";
}

function LegResultIcon({ status }: { status: LegStatus }) {
  if (status === "won") {
    return (
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-200"
        aria-label="Acertada"
        title="Acertada"
      >
        <Check className="h-4 w-4" strokeWidth={2.5} />
      </span>
    );
  }
  if (status === "lost") {
    return (
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-rose-500/20 text-rose-200"
        aria-label="Fallida"
        title="Fallida"
      >
        <X className="h-4 w-4" strokeWidth={2.5} />
      </span>
    );
  }
  if (status === "void") {
    return (
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-100"
        aria-label="Anulada"
        title="Anulada"
      >
        <CircleSlash className="h-3.5 w-3.5" />
      </span>
    );
  }
  return (
    <span
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-500/20 text-sky-200"
      aria-label="Pendiente"
      title="Pendiente"
    >
      <Clock className="h-3.5 w-3.5" />
    </span>
  );
}

function LegDetailRow({ leg }: { leg: HistoryBetLeg }) {
  const home = leg.homeTeam || leg.matchLabel.split(/\s+vs\.?\s+/i)[0] || "—";
  const away =
    leg.awayTeam || leg.matchLabel.split(/\s+vs\.?\s+/i)[1] || "";
  const matchName = away ? `${home} vs ${away}` : home;
  const statusLine = formatLegMatchStatus(leg);
  const explicit = getExplicitPickLabel(
    leg.market,
    leg.marketLabel,
    home,
    away || "Visitante"
  );

  return (
    <li
      className={cn(
        "flex gap-3 rounded-lg border px-3 py-2.5",
        leg.status === "won" && "border-emerald-500/20 bg-emerald-500/5",
        leg.status === "lost" && "border-rose-500/20 bg-rose-500/5",
        leg.status === "void" && "border-amber-500/20 bg-amber-500/5",
        leg.status === "pending" && "border-slate-600 bg-slate-950/50"
      )}
    >
      <LegResultIcon status={leg.status} />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-medium leading-snug text-slate-100">
          {matchName}
        </p>
        <p className="text-sm text-slate-200">
          {formatExplicitBetLine(explicit)}
          <span className="mx-1.5 text-slate-400">·</span>
          <span className="font-mono text-emerald-200">
            @{formatOdds(leg.odds)}
          </span>
        </p>
        <p className="text-xs leading-snug text-sky-200">
          {explicit.bookmakerTab}
        </p>
        <p className="text-xs text-slate-300">
          {statusLine}
          {leg.leagueName ? (
            <span className="text-slate-300"> · {leg.leagueName}</span>
          ) : null}
        </p>
      </div>
    </li>
  );
}

function BetRow({
  bet,
  removing = false,
  onDelete,
}: {
  bet: HistoryBet;
  removing?: boolean;
  onDelete: () => void;
}) {
  const isSingle = bet.legs.length === 1 || bet.timeframe === "Individual";
  const [expanded, setExpanded] = useState(false);

  const hits = countLegHits(bet.legs);
  const hitsVariant = legHitsBadgeVariant(bet.status);
  const statusBadge = ticketStatusBadge(bet.status);
  const unitPnl = ticketProfit(bet);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-slate-600 bg-slate-950/50 transition-all duration-200 ease-out motion-reduce:transition-none",
        removing
          ? "max-h-0 -translate-y-1 scale-[0.98] border-transparent opacity-0"
          : "max-h-[2000px] translate-y-0 scale-100 opacity-100"
      )}
    >
      <div className="p-4">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
            <button
              type="button"
              aria-label="Eliminar esta combinada del historial"
              title="Eliminar del historial"
              onClick={onDelete}
              disabled={removing}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-slate-300 transition-colors hover:bg-rose-500/20 hover:text-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 disabled:opacity-40"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
            <Badge
              variant={hitsVariant}
              className="gap-1 font-semibold tracking-tight"
            >
              <Check className="h-3 w-3 text-emerald-400" strokeWidth={2.5} />
              {hits.won} / {hits.total} Acertadas
            </Badge>
            <Badge variant={bet.mode === "Segura" ? "success" : "warning"}>
              {bet.mode} · {bet.timeframe}
            </Badge>
            <span className="text-xs text-slate-300">{bet.date}</span>
          </div>
          <p className="text-sm text-slate-200">
            {bet.legs.length} legs · Multiplicador {formatOdds(bet.totalOdds)}x
            · {formatCLP(bet.stakeCLP)}
          </p>
          {(bet.status === "won" || bet.status === "lost") && (
            <p
              className={`text-xs font-medium ${
                unitPnl >= 0 ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              Resultado {formatSignedCLP(unitPnl)}
            </p>
          )}
        </div>
      </div>

      <div className="border-t border-slate-800/80 px-2 pb-2">
        {isSingle ? (
          <ul className="space-y-2 px-1 py-2">
            {bet.legs.map((leg, idx) => (
              <LegDetailRow
                key={`${leg.fixtureId}-${leg.market}-${idx}`}
                leg={leg}
              />
            ))}
          </ul>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-2 py-2.5 text-left text-sm text-slate-200 transition hover:bg-slate-800 hover:text-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
              aria-expanded={expanded}
              disabled={removing}
            >
              <span className="inline-flex flex-wrap items-center gap-2">
                Desglose de legs
                <LegHitsInline hits={hits} className="text-slate-300" />
              </span>
              <ChevronDown
                aria-hidden
                className={cn(
                  "h-4 w-4 shrink-0 text-slate-300 transition-transform motion-reduce:transition-none",
                  expanded && "rotate-180"
                )}
              />
            </button>

            {expanded && (
              <ul className="space-y-2 px-1 pb-2 pt-1">
                {bet.legs.map((leg, idx) => (
                  <LegDetailRow
                    key={`${leg.fixtureId}-${leg.market}-${idx}`}
                    leg={leg}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
