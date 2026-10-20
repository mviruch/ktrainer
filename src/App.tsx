import { useEffect } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router";
import { PhoneOrderChrome, usePhoneLayout } from "@/components/phone-order";
import { Readout } from "@/components/readout";
import { Side } from "@/components/result-panel";
import { ActionSheets, RouteSheets } from "@/components/sheets";
import { Stage } from "@/components/stage";
import { TrainerProvider, useTrainer } from "@/state/trainer";
import { TooltipProvider } from "@/components/ui/tooltip";

export function App() {
  return (
    <BrowserRouter>
      <TrainerProvider>
        <TooltipProvider>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={null} />
            <Route path="stats" element={null} />
            <Route path="settings" element={null} />
            <Route path="help" element={null} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
        </TooltipProvider>
      </TrainerProvider>
    </BrowserRouter>
  );
}

function Shell() {
  const t = useTrainer();
  const phone = usePhoneLayout();
  useEffect(() => {
    const apply = () => {
      // compact chrome when short, or when wide but not full desktop
      document.body.classList.toggle("compact", window.innerHeight < 860 || (window.innerWidth >= 1024 && window.innerWidth < 1280));
    };
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);
  useEffect(() => {
    document.body.classList.toggle("redup", !t.cfg.greenUp);
  }, [t.cfg.greenUp]);

  return (
    <div id="app">
      <Readout />
      <div id="main">
        <Stage />
        {phone ? <PhoneOrderChrome /> : <Side />}
      </div>
      <Outlet />
      <RouteSheets />
      <ActionSheets />
      <Hotkeys />
      {t.toast && <div id="toast">{t.toast}</div>}
    </div>
  );
}

function Hotkeys() {
  const t = useTrainer();
  const nav = useNavigate();
  const loc = useLocation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      const routed = loc.pathname !== "/";
      if (e.key === "Escape") {
        if (t.dialog) {
          t.closeDialog();
          return;
        }
        if (routed) nav("/");
        return;
      }
      if (t.dialog || routed || document.querySelector("[role=dialog]")) return;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.code === "Space") {
        e.preventDefault();
        t.togglePlay();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        t.step();
      } else if (e.key === "f" || e.key === "F") t.fit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [t, loc.pathname, nav]);
  return null;
}
