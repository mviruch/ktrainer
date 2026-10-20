import { useEffect, useRef, useState } from "react";
import { SideContent } from "@/components/result-panel";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useTrainer } from "@/state/trainer";

/** Match CSS @media (max-width: 1023px) — phone IA (Sheet), not a third layout. */
export function usePhoneLayout() {
  const [phone, setPhone] = useState(() => (typeof window !== "undefined" ? window.innerWidth < 1024 : false));
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const apply = () => {
      setPhone(mq.matches);
      document.body.classList.toggle("phone", mq.matches);
      document.body.classList.toggle("wide", !mq.matches);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return phone;
}

export function PhoneOrderChrome() {
  const t = useTrainer();
  const [open, setOpen] = useState(false);
  const autoKey = useRef<string | number | null>(null);
  const title =
    t.phase === "trade"
      ? "下单"
      : t.phase === "result"
        ? "本局结算"
        : t.phase === "loading"
          ? "抽取中"
          : t.phase === "error"
            ? "行情"
            : "准备";

  // Auto-open settle sheet once per result (user can dismiss; won't force re-open).
  useEffect(() => {
    if (t.phase !== "result") return;
    const key = t.result?.rec?.t0 ?? t.result?.rec?.startedAt ?? "result";
    if (autoKey.current === key) return;
    autoKey.current = key;
    setOpen(true);
  }, [t.phase, t.result?.rec?.t0, t.result?.rec?.startedAt]);

  return (
    <>
      <div id="phone-dock" className="flex min-h-11 shrink-0 items-center border-t border-line bg-panel px-3 py-1.5 pb-[max(6px,env(safe-area-inset-bottom))]">
        <Button variant="primary" size="default" className="h-11 min-h-11 w-full text-[15px] font-medium" onClick={() => setOpen(true)}>
          {title}
        </Button>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="h-[min(88dvh,760px)] gap-0 p-0">
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription className="sr-only">手机下单与结算面板</SheetDescription>
          </SheetHeader>
          <SheetBody className="pb-[max(12px,env(safe-area-inset-bottom))]">
            <SideContent />
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  );
}
