"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBankroll } from "@/lib/bankroll-store";
import { cn, formatCLP, formatStakeInput, parseStakeCLP } from "@/lib/utils";
import { Pencil, Wallet } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

const QUICK_ADD = [5_000, 10_000] as const;

export function BankrollHeader({ className }: { className?: string }) {
  const { settings, setTotalBankroll, adjustBankroll, saveSettings } = useBankroll();
  const [open, setOpen] = useState(false);
  const [bankrollInput, setBankrollInput] = useState("");
  const [minStakeInput, setMinStakeInput] = useState("");
  const [payoutInput, setPayoutInput] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const migratedMinStake = useRef(false);
  useEffect(() => {
    if (migratedMinStake.current || typeof window === "undefined") return;
    migratedMinStake.current = true;
    try {
      const flag = "parleylab_min_stake_migrated_75";
      if (localStorage.getItem(flag)) return;
      localStorage.setItem(flag, "1");
      if (settings.minBookmakerStake === 500) {
        saveSettings({ minBookmakerStake: 75 });
      }
    } catch {
      /* ignore quota / private mode */
    }
  }, [saveSettings, settings.minBookmakerStake]);

  useEffect(() => {
    if (!open) return;
    setBankrollInput(formatStakeInput(String(settings.totalBankroll)));
    setMinStakeInput(formatStakeInput(String(settings.minBookmakerStake)));
    setPayoutInput("");
  }, [open, settings.totalBankroll, settings.minBookmakerStake]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      const node = panelRef.current;
      if (node && !node.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const parsedBankroll = parseStakeCLP(bankrollInput);
  const parsedMinStake = parseStakeCLP(minStakeInput);
  const parsedPayout = parseStakeCLP(payoutInput);

  function handleSaveBankroll() {
    if (parsedBankroll == null) return;
    setTotalBankroll(parsedBankroll);
    if (parsedMinStake != null) {
      saveSettings({ minBookmakerStake: parsedMinStake });
    }
    setOpen(false);
  }

  function handleAddPayout() {
    if (parsedPayout == null) return;
    adjustBankroll(parsedPayout);
    setPayoutInput("");
    setOpen(false);
  }

  return (
    <div ref={panelRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Banca actual ${formatCLP(settings.totalBankroll)}. Editar banca.`}
        className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-xl border border-emerald-400/35 bg-emerald-500/10 px-2.5 py-1 text-left text-xs font-medium text-emerald-100 transition hover:border-emerald-300/50 hover:bg-emerald-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
      >
        <Wallet className="h-3.5 w-3.5 shrink-0 text-emerald-300" aria-hidden />
        <span className="hidden sm:inline">Banca Actual:</span>
        <span className="tabular-nums">{formatCLP(settings.totalBankroll)}</span>
        <Pencil className="h-3 w-3 shrink-0 text-emerald-300/80" aria-hidden />
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          className="absolute right-0 z-50 mt-2 w-[min(calc(100vw-2rem),22rem)] rounded-2xl border border-slate-600 bg-[var(--background-elevated)] p-4 shadow-xl shadow-black/40 max-sm:fixed max-sm:left-4 max-sm:right-4 max-sm:w-auto"
        >
          <h2 id={titleId} className="text-sm font-semibold text-slate-50">
            Editar Banca
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-300">
            El stake sugerido de picks y combinadas se recalcula al guardar.
          </p>

          <div className="mt-3 space-y-2">
            <Label htmlFor="bankroll-total">Banca total ({settings.currency})</Label>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-400">
                $
              </span>
              <Input
                id="bankroll-total"
                inputMode="decimal"
                autoComplete="off"
                value={bankrollInput}
                onChange={(event) =>
                  setBankrollInput(formatStakeInput(event.target.value))
                }
                className="pl-7"
                placeholder="30.000"
              />
            </div>
          </div>

          <div className="mt-3 space-y-2">
            <Label htmlFor="bankroll-min-stake">Mínimo de la casa (CLP)</Label>
            <p className="text-xs text-slate-400">
              Ningún ticket sugerido baja de este piso (Betano / JugaBet / Coolbet).
            </p>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-400">
                $
              </span>
              <Input
                id="bankroll-min-stake"
                inputMode="decimal"
                autoComplete="off"
                value={minStakeInput}
                onChange={(event) =>
                  setMinStakeInput(formatStakeInput(event.target.value))
                }
                className="pl-7"
                placeholder="75"
              />
            </div>
            <Button
              size="sm"
              className="w-full"
              disabled={parsedBankroll == null}
              onClick={handleSaveBankroll}
            >
              Guardar banca
            </Button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {QUICK_ADD.map((delta) => (
              <Button
                key={delta}
                type="button"
                size="sm"
                variant="outline"
                onClick={() => adjustBankroll(delta)}
              >
                +{formatCLP(delta).replace(" CLP", "")}
              </Button>
            ))}
          </div>

          <div className="mt-4 space-y-2 border-t border-slate-600 pt-3">
            <Label htmlFor="bankroll-payout">Reajustar tras cobro</Label>
            <p className="text-xs text-slate-400">
              Al registrar un ticket se descuenta el stake. Aquí suma el retorno
              cobrado en la casa (incluye la apuesta recuperada si ganaste).
            </p>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-400">
                $
              </span>
              <Input
                id="bankroll-payout"
                inputMode="decimal"
                autoComplete="off"
                value={payoutInput}
                onChange={(event) =>
                  setPayoutInput(formatStakeInput(event.target.value))
                }
                className="pl-7"
                placeholder="Monto cobrado"
              />
            </div>
            <Button
              size="sm"
              variant="secondary"
              className="w-full"
              disabled={parsedPayout == null}
              onClick={handleAddPayout}
            >
              Sumar cobro a la banca
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
