"use client";

import { BottomSheet } from "@/components/bottom-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  isRecentManagerStart,
  type TeamProfileSnapshot,
} from "@/lib/team-profile-shared";
import { isTeamProfileOriginLeagueId } from "@/config/allowed-leagues";
import { getLeagueDisplayName } from "@/lib/utils/league-labels";
import { cn, formatPercent } from "@/lib/utils";
import {
  ChevronDown,
  Loader2,
  RefreshCw,
  Search,
  Shield,
  Users,
} from "lucide-react";
import Image from "next/image";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

type ProfilesPayload = {
  success: boolean;
  profiles?: TeamProfileSnapshot[];
  leagues?: string[];
  count?: number;
  error?: string;
};

type SortKey = "matches" | "over15" | "cleanSheet" | "name";
type StatusFilter = "all" | "absences" | "manager";

const PAGE_SIZE = 12;

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "matches", label: "Más analizados" },
  { value: "over15", label: "Mayor % Over 1.5" },
  { value: "cleanSheet", label: "Mejor defensa (CS)" },
  { value: "name", label: "Nombre (A-Z)" },
];

function teamLogoUrl(teamId: number): string {
  return `https://media.api-sports.io/football/teams/${teamId}.png`;
}

function hasRecentManager(p: TeamProfileSnapshot): boolean {
  return Boolean(
    p.lastManagerChangeDate && isRecentManagerStart(p.lastManagerChangeDate)
  );
}

/** Accordion key: domestic origin display name, else "Otros". */
function profileLeagueGroupKey(profile: TeamProfileSnapshot): string {
  const id = profile.primaryLeagueId;
  if (id != null && isTeamProfileOriginLeagueId(id)) {
    return getLeagueDisplayName(id);
  }
  const named = profile.leagueName?.trim();
  if (named && named !== "Otros") return named;
  return "Otros";
}

function sortProfiles(
  list: TeamProfileSnapshot[],
  sort: SortKey
): TeamProfileSnapshot[] {
  const out = [...list];
  out.sort((a, b) => {
    switch (sort) {
      case "over15":
        return b.over15GoalsRate - a.over15GoalsRate || a.teamName.localeCompare(b.teamName, "es");
      case "cleanSheet":
        return (
          b.cleanSheetRate - a.cleanSheetRate ||
          a.teamName.localeCompare(b.teamName, "es")
        );
      case "name":
        return a.teamName.localeCompare(b.teamName, "es");
      default:
        return (
          b.totalMatchesAnalyzed - a.totalMatchesAnalyzed ||
          a.teamName.localeCompare(b.teamName, "es")
        );
    }
  });
  return out;
}

function MetricBar({
  label,
  home,
  away,
}: {
  label: string;
  home: number;
  away: number;
}) {
  const max = Math.max(home, away, 0.01);
  return (
    <div className="space-y-1">
      <p className="text-xs text-neutral-500">{label}</p>
      <div className="grid grid-cols-2 gap-2 text-[11px] tabular-nums">
        <div>
          <div className="mb-0.5 flex justify-between text-neutral-400">
            <span>Local</span>
            <span>{home.toFixed(2)}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-[#30d158]/80"
              style={{ width: `${Math.min(100, (home / max) * 100)}%` }}
            />
          </div>
        </div>
        <div>
          <div className="mb-0.5 flex justify-between text-neutral-400">
            <span>Visita</span>
            <span>{away.toFixed(2)}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-[#0a84ff]/80"
              style={{ width: `${Math.min(100, (away / max) * 100)}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function TeamCard({
  profile,
  onOpen,
}: {
  profile: TeamProfileSnapshot;
  onOpen: () => void;
}) {
  const recentDt = hasRecentManager(profile);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="pressable group w-full rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-left transition hover:border-white/20 hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0a84ff]"
    >
      <div className="flex items-start gap-2.5">
        <Image
          src={teamLogoUrl(profile.teamId)}
          alt=""
          width={36}
          height={36}
          className="mt-0.5 h-9 w-9 shrink-0 rounded-lg bg-white/5 object-contain"
          unoptimized
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate text-sm font-semibold text-white">
              {profile.teamName}
            </p>
            <Badge variant="default" className="max-w-[12rem] shrink-0 truncate px-2 py-0 text-[10px]">
              {profileLeagueGroupKey(profile)}
            </Badge>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge
              variant={profile.over15GoalsRate > 0.8 ? "success" : "default"}
              className="px-2 py-0 text-[10px] tabular-nums"
            >
              {formatPercent(profile.over15GoalsRate, 0)} Over 1.5
            </Badge>
            <Badge variant="info" className="px-2 py-0 text-[10px] tabular-nums">
              {formatPercent(profile.cleanSheetRate, 0)} CS
            </Badge>
            <Badge variant="default" className="px-2 py-0 text-[10px] tabular-nums">
              N={profile.totalMatchesAnalyzed}
            </Badge>
          </div>
          {(profile.keyAbsencesCount > 0 || recentDt) && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {profile.keyAbsencesCount > 0 ? (
                <Badge variant="warning" className="px-2 py-0 text-[10px]">
                  ⚠ {profile.keyAbsencesCount} bajas claves
                </Badge>
              ) : null}
              {recentDt ? (
                <Badge variant="danger" className="px-2 py-0 text-[10px]">
                  👔 DT nuevo
                </Badge>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

export default function TeamsPage() {
  const [query, setQuery] = useState("");
  const [league, setLeague] = useState("all");
  const [sort, setSort] = useState<SortKey>("matches");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [loading, setLoading] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<TeamProfileSnapshot[]>([]);
  const [leagues, setLeagues] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [visibleByLeague, setVisibleByLeague] = useState<Record<string, number>>(
    {}
  );
  const [selected, setSelected] = useState<TeamProfileSnapshot | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/teams/profiles?limit=300", {
        cache: "no-store",
      });
      const json = (await res.json()) as ProfilesPayload;
      if (!res.ok || !json.success) {
        setError(json.error ?? "No se pudieron cargar los perfiles.");
        setProfiles([]);
        return;
      }
      setProfiles(json.profiles ?? []);
      setLeagues(json.leagues ?? []);
    } catch {
      setError("Error de red al cargar perfiles.");
      setProfiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = profiles;
    if (q) {
      list = list.filter((p) => p.teamName.toLowerCase().includes(q));
    }
    if (league !== "all") {
      list = list.filter((p) => profileLeagueGroupKey(p) === league);
    }
    if (status === "absences") {
      list = list.filter((p) => p.keyAbsencesCount > 0);
    } else if (status === "manager") {
      list = list.filter((p) => hasRecentManager(p));
    }
    return sortProfiles(list, sort);
  }, [profiles, query, league, status, sort]);

  const grouped = useMemo(() => {
    const map = new Map<string, TeamProfileSnapshot[]>();
    for (const p of filtered) {
      const key = profileLeagueGroupKey(p);
      const arr = map.get(key);
      if (arr) arr.push(p);
      else map.set(key, [p]);
    }
    // "Otros" only when teams truly lack a domestic origin league id
    return [...map.entries()].sort(([a], [b]) => {
      if (a === "Otros") return 1;
      if (b === "Otros") return -1;
      return a.localeCompare(b, "es");
    });
  }, [filtered]);

  const leagueOptions = useMemo(() => {
    const fromApi = leagues.filter((n) => n && n !== "Otros");
    const fromProfiles = [
      ...new Set(profiles.map(profileLeagueGroupKey).filter((k) => k !== "Otros")),
    ];
    const merged = [...new Set([...fromApi, ...fromProfiles])].sort((a, b) =>
      a.localeCompare(b, "es")
    );
    const hasOtros = profiles.some((p) => profileLeagueGroupKey(p) === "Otros");
    return hasOtros ? [...merged, "Otros"] : merged;
  }, [leagues, profiles]);

  const rebuild = async () => {
    setRebuilding(true);
    setError(null);
    try {
      const res = await fetch("/api/teams/profiles", { method: "POST" });
      const json = (await res.json()) as ProfilesPayload;
      if (!res.ok || !json.success) {
        setError(json.error ?? "No se pudo recalcular.");
        return;
      }
      setProfiles(json.profiles ?? []);
      setLeagues(json.leagues ?? []);
      setVisibleByLeague({});
    } catch {
      setError("Error de red al recalcular perfiles.");
    } finally {
      setRebuilding(false);
    }
  };

  const patchSelected = async (patch: {
    keyAbsencesCount?: number;
    clearManager?: boolean;
  }) => {
    if (!selected) return;
    setSaving(true);
    try {
      const res = await fetch("/api/teams/profiles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamId: selected.teamId,
          teamName: selected.teamName,
          ...patch,
        }),
      });
      const json = (await res.json()) as {
        success: boolean;
        profile?: TeamProfileSnapshot;
        error?: string;
      };
      if (!res.ok || !json.success || !json.profile) {
        setError(json.error ?? "No se pudo guardar el override.");
        return;
      }
      setProfiles((prev) =>
        prev.map((p) => (p.teamId === json.profile!.teamId ? json.profile! : p))
      );
      setSelected(json.profile);
    } catch {
      setError("Error de red al guardar override.");
    } finally {
      setSaving(false);
    }
  };

  const selectClass =
    "native-select min-h-11 w-full appearance-none rounded-2xl border border-white/15 bg-neutral-900 px-3 pr-9 text-sm text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] [color-scheme:dark] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0a84ff] focus-visible:ring-offset-2 focus-visible:ring-offset-black";

  return (
    <main className="mx-auto max-w-6xl px-3 py-6 sm:px-6 sm:py-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            Calibración histórica
          </p>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight text-white">
            <Users className="h-6 w-6 text-[#30d158]" aria-hidden />
            Perfiles de Equipos
          </h1>
          <p className="mt-1 max-w-xl text-sm text-neutral-400">
            Busca, filtra y agrupa por liga. Los flags de DT/bajas alimentan
            Poisson automáticamente.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={rebuilding}
          onClick={() => void rebuild()}
          className="gap-2"
        >
          {rebuilding ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="h-4 w-4" aria-hidden />
          )}
          Recalcular desde DB
        </Button>
      </div>

      <div className="mb-4 space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 sm:p-4">
        <label className="relative block">
          <span className="sr-only">Buscar equipo</span>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar equipo…"
            className="w-full rounded-xl border border-white/10 bg-black/20 py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-neutral-500 outline-none ring-[#0a84ff] focus:ring-2"
          />
        </label>

        <div className="flex flex-wrap gap-2">
          <label className="flex min-w-[10rem] flex-1 flex-col gap-1">
            <span className="text-[11px] text-neutral-500">Liga</span>
            <div className="relative">
              <select
                value={league}
                onChange={(e) => setLeague(e.target.value)}
                className={selectClass}
              >
                <option value="all">Todas las ligas</option>
                {leagueOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
                aria-hidden
              />
            </div>
          </label>
          <label className="flex min-w-[10rem] flex-1 flex-col gap-1">
            <span className="text-[11px] text-neutral-500">Orden</span>
            <div className="relative">
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className={selectClass}
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
                aria-hidden
              />
            </div>
          </label>
        </div>

        <div className="flex flex-wrap gap-2" role="group" aria-label="Estado">
          {(
            [
              { id: "all", label: "Todos" },
              { id: "absences", label: "⚠ Con bajas claves" },
              { id: "manager", label: "👔 Con cambio de DT" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setStatus(opt.id)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition",
                status === opt.id
                  ? "bg-white/12 text-white ring-white/25"
                  : "bg-transparent text-neutral-400 ring-white/10 hover:bg-white/[0.06] hover:text-white"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="mb-4 text-sm text-[#ff453a]" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-neutral-400">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Cargando perfiles…
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-white/10 bg-white/[0.03]">
          <CardHeader>
            <CardTitle className="text-base">Sin resultados</CardTitle>
            <CardDescription>
              Ajusta búsqueda/filtros o recalcula desde partidos liquidados.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-neutral-500">
            {filtered.length} equipo{filtered.length === 1 ? "" : "s"} ·{" "}
            {grouped.length} liga{grouped.length === 1 ? "" : "s"}
          </p>
          {grouped.map(([leagueName, teams]) => {
            const isCollapsed = collapsed[leagueName] === true;
            const shown = visibleByLeague[leagueName] ?? PAGE_SIZE;
            const slice = teams.slice(0, shown);
            const hasMore = teams.length > shown;
            return (
              <section
                key={leagueName}
                className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]"
              >
                <button
                  type="button"
                  onClick={() =>
                    setCollapsed((prev) => ({
                      ...prev,
                      [leagueName]: !isCollapsed,
                    }))
                  }
                  className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-white/[0.04] sm:px-4"
                  aria-expanded={!isCollapsed}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Shield className="h-4 w-4 shrink-0 text-[#0a84ff]" aria-hidden />
                    <span className="truncate font-medium text-white">
                      {leagueName}
                    </span>
                    <Badge variant="info" className="shrink-0 tabular-nums">
                      {teams.length} equipo{teams.length === 1 ? "" : "s"}
                    </Badge>
                  </span>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 shrink-0 text-neutral-400 transition",
                      !isCollapsed && "rotate-180"
                    )}
                    aria-hidden
                  />
                </button>
                {!isCollapsed ? (
                  <div className="border-t border-white/5 px-3 pb-3 pt-2 sm:px-4">
                    <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {slice.map((p) => (
                        <li key={p.teamId}>
                          <TeamCard
                            profile={p}
                            onOpen={() => setSelected(p)}
                          />
                        </li>
                      ))}
                    </ul>
                    {hasMore ? (
                      <div className="mt-3 flex justify-center">
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() =>
                            setVisibleByLeague((prev) => ({
                              ...prev,
                              [leagueName]: shown + PAGE_SIZE,
                            }))
                          }
                        >
                          Ver más equipos ({teams.length - shown} restantes)
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      )}

      <BottomSheet
        open={selected != null}
        onClose={() => setSelected(null)}
        title={selected?.teamName ?? "Equipo"}
        desktopClassName="md:max-w-lg"
      >
        {selected ? (
          <div className="space-y-4 pb-6">
            <div className="flex items-center gap-3">
              <Image
                src={teamLogoUrl(selected.teamId)}
                alt=""
                width={48}
                height={48}
                className="h-12 w-12 rounded-xl bg-white/5 object-contain"
                unoptimized
              />
              <div className="min-w-0">
                <p className="text-sm text-neutral-400">
                  {selected.leagueName ?? "Otros"} · id {selected.teamId}
                </p>
                <p className="text-sm text-neutral-300">
                  Ventana {selected.totalMatchesAnalyzed} · Local{" "}
                  {selected.homeMatchesCount} / Visita{" "}
                  {selected.awayMatchesCount}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              <Badge
                variant={selected.over15GoalsRate > 0.8 ? "success" : "default"}
              >
                {formatPercent(selected.over15GoalsRate)} Over 1.5
              </Badge>
              <Badge variant="info">
                {formatPercent(selected.cleanSheetRate)} Clean sheet
              </Badge>
              <Badge variant="default">
                {formatPercent(selected.over25GoalsRate)} Over 2.5
              </Badge>
            </div>

            <div className="space-y-3 rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                Split local / visita
              </p>
              <MetricBar
                label="Goles a favor (prom.)"
                home={selected.avgGoalsScoredHome}
                away={selected.avgGoalsScoredAway}
              />
              <MetricBar
                label="Goles en contra (prom.)"
                home={selected.avgGoalsConcededHome}
                away={selected.avgGoalsConcededAway}
              />
              <MetricBar
                label="Over 1.5 rate"
                home={selected.over15GoalsRateHome}
                away={selected.over15GoalsRateAway}
              />
              <MetricBar
                label="Clean sheet rate"
                home={selected.cleanSheetRateHome}
                away={selected.cleanSheetRateAway}
              />
            </div>

            <div className="space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                Contexto (override manual)
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-sm text-neutral-300">
                  Bajas claves
                  <input
                    type="number"
                    min={0}
                    max={20}
                    value={selected.keyAbsencesCount}
                    disabled={saving}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (!Number.isFinite(n)) return;
                      setSelected({
                        ...selected,
                        keyAbsencesCount: Math.max(0, Math.floor(n)),
                      });
                    }}
                    className="w-16 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-sm tabular-nums outline-none focus:ring-2 focus:ring-[#0a84ff]"
                  />
                </label>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={saving}
                  onClick={() =>
                    void patchSelected({
                      keyAbsencesCount: selected.keyAbsencesCount,
                    })
                  }
                >
                  Guardar bajas
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-300">
                <span>
                  DT:{" "}
                  {selected.lastManagerChangeDate
                    ? new Date(selected.lastManagerChangeDate).toLocaleDateString(
                        "es-CL"
                      )
                    : "sin registro"}
                  {hasRecentManager(selected) ? " (reciente)" : ""}
                </span>
                {selected.lastManagerChangeDate ? (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={saving}
                    onClick={() => void patchSelected({ clearManager: true })}
                  >
                    Limpiar DT
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </BottomSheet>
    </main>
  );
}
