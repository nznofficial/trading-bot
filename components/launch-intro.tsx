import Image from "next/image";
import { ART } from "@/components/art";

/**
 * Launch sequence shown once per browser session. Rendered on the server so it covers the first
 * paint; LAUNCH_SCRIPT (in <head>) marks <html data-launched> on repeat visits before paint, and
 * CSS hides it. Pure CSS animation, removed entirely for reduced-motion users.
 */
export const LAUNCH_SCRIPT = `try{if(sessionStorage.getItem("pt-launched"))document.documentElement.dataset.launched="1";else sessionStorage.setItem("pt-launched","1")}catch(e){document.documentElement.dataset.launched="1"}`;

export function LaunchIntro() {
  return (
    <div
      aria-hidden
      className="launch-intro pointer-events-none fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#08070c]"
    >
      {/* Catapult tunnel behind the title; darkened so the type stays the focus. */}
      {/* Lazy: on repeat visits the overlay is display:none, so the browser never fetches it. */}
      <Image src={ART.launch} alt="" fill sizes="100vw" className="object-cover opacity-55" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(8,7,12,0.35),rgba(8,7,12,0.92))]" />
      <div className="hazard hazard-live absolute inset-x-0 top-0 h-3" />
      <div className="hazard hazard-live absolute inset-x-0 bottom-0 h-3" />
      <div className="hud wipe relative text-[13px] text-amber" style={{ animationDelay: "0.05s" }}>
        Pilot authenticated · Sync confirmed
      </div>
      <div
        className="slam relative mt-3 font-title text-[64px] leading-none font-extrabold text-ink sm:text-[96px]"
        style={{ animationDelay: "0.3s" }}
      >
        LAUNCH
      </div>
      <div className="hud wipe relative mt-4 text-[15px] text-sync" style={{ animationDelay: "0.75s" }}>
        Paper Trader — all units, sortie
      </div>
    </div>
  );
}
