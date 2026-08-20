"use client";

import { BottomSheet } from "@/components/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBankroll } from "@/lib/bankroll-store";
import { cn, formatCLP, formatStakeInput, parseStakeCLP } from "@/lib/utils";
import { Pencil, Wallet } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

const QUICK_ADD = [5_000, 10_000] as const;

/** Dispatched by MobileTabBar “Banca” tab */
export const OPEN_BANKROLL_EVENT = "parleylab:open-bankroll";

export function BankrollHeader({
  className,
  triggerClassName,
}: {
  className?: string;
  triggerClassName?: string;
}) {
  const { settings, setTotalBankroll, adjustBankroll, saveSettings } =
    useBankroll();
  const [open, setOpen] = useState(false);
  const [bankrollInput, setBankrollInput] = useState("");
  const [minStakeInput, setMinStakeInput] = useState("");
  const [payoutInput, setPayoutInput] = useState("");

  const close = useCallback(() => setOpen(false), []);

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
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener(OPEN_BANKROLL_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_BANKROLL_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    setBankrollInput(formatStakeInput(String(settings.totalBankroll)));
    setMinStakeInput(formatStakeInput(String(settings.minBookmakerStake)));
    setPayoutInput("");
  }, [open, settings.totalBankroll, settings.minBookmakerStake]);

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
    <div className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Banca actual ${formatCLP(settings.totalBankroll)}. Editar banca.`}
        className={cn(
          "pressable touch-target inline-flex max-w-full select-none items-center gap-2 rounded-full bg-[#30d158]/12 px-3 text-left text-xs font-semibold text-[#30d158] ring-1 ring-[#30d158]/25 hover:bg-[#30d158]/18 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0a84ff]",
          triggerClassName
        )}
      >
        <span
          aria-hidden
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#30d158]"
        />
        <Wallet className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="hidden font-medium text-neutral-400 sm:inline">
          Banca
        </span>
        <span className="max-w-[9.5rem] truncate tabular-nums text-white sm:max-w-none">
          {formatCLP(settings.totalBankroll)}
        </span>
        <Pencil className="h-3 w-3 shrink-0 text-neutral-500" aria-hidden />
      </button>

      <BottomSheet open={open} onClose={close} title="Editar Banca">
        <p className="mb-3 text-xs leading-relaxed text-neutral-400">
          El stake sugerido de picks y combinadas se recalcula al guardar.
        </p>

        <div className="space-y-2">
          <Label htmlFor="bankroll-total">
            Banca total ({settings.currency})
          </Label>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-neutral-500">
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
          <p className="text-xs text-neutral-500">
            Ningún ticket sugerido baja de este piso (Betano / JugaBet /
            Coolbet).
          </p>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-neutral-500">
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
            className="min-h-11 w-full"
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
              className="min-h-11"
              onClick={() => adjustBankroll(delta)}
            >
              +{formatCLP(delta).replace(" CLP", "")}
            </Button>
          ))}
        </div>

        <div className="mt-4 space-y-2 border-t border-white/10 pt-3">
          <Label htmlFor="bankroll-payout">Reajustar tras cobro</Label>
          <p className="text-xs text-neutral-500">
            Al registrar un ticket se descuenta el stake. Aquí suma el retorno
            cobrado en la casa (incluye la apuesta recuperada si ganaste).
          </p>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-neutral-500">
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
            className="min-h-11 w-full"
            disabled={parsedPayout == null}
            onClick={handleAddPayout}
          >
            Sumar cobro a la banca
          </Button>
        </div>
      </BottomSheet>
    </div>
  );
}
