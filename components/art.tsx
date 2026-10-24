import Image from "next/image";
import type { ReactNode } from "react";
import type { BriefAttrs } from "@/lib/briefings";

/** Generated art lives in public/art (see art/manifest.ts for what each piece is). */
export const ART = {
  jc316Keyart: "/art/jc316-keyart.webp",
  vanguardBust: "/art/vanguard-bust.webp",
  recoilBust: "/art/recoil-bust.webp",
  vanguardKeyart: "/art/vanguard-keyart.webp",
  recoilKeyart: "/art/recoil-keyart.webp",
  hangar: "/art/scene-hangar.webp",
  bridge: "/art/scene-bridge.webp",
  simdeck: "/art/scene-simdeck.webp",
  launch: "/art/scene-launch.webp",
  victory: "/art/event-victory.webp",
  damage: "/art/event-damage.webp",
  noContact: "/art/empty-nocontact.webp",
  /** Full 1024px version for empty states that fill a whole panel. */
  noContactLarge: "/art/empty-nocontact-lg.webp",
  cold: "/art/empty-cold.webp",
  awaiting: "/art/empty-awaiting.webp",
} as const;

export const unitBust = (strategy: string) => (strategy === "sma_cross" ? ART.vanguardBust : ART.recoilBust);

/**
 * Painted scene behind a page header. The image is decorative (empty alt); a gradient keeps
 * the header text legible, and `figure` lets a character stand over the right edge.
 */
export function SceneBanner({
  src,
  children,
  figure,
  height = "h-56 sm:h-64",
  position = "center",
  brief,
}: {
  src: string;
  children: ReactNode;
  figure?: { src: string; alt: string };
  height?: string;
  position?: string;
  brief?: BriefAttrs;
}) {
  return (
    <section {...brief} className={`frame boot relative mb-7 ${height}`}>
      <div className="frame-body relative overflow-hidden">
        <Image
          src={src}
          alt=""
          fill
          priority
          sizes="(max-width: 1280px) 100vw, 1280px"
          className="object-cover"
          style={{ objectPosition: position }}
        />
        {/* Darken only behind the title so the scene's characters stay visible. */}
        <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-[#08070c]/95 from-0% via-[#08070c]/55 via-35% to-transparent to-60%" />
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#08070c]/80 to-transparent" />
        {figure && (
          <div className="pointer-events-none absolute right-2 bottom-0 hidden h-full w-[34%] sm:block">
            <Image src={figure.src} alt={figure.alt} fill sizes="34vw" className="object-contain object-bottom drop-shadow-[0_0_24px_rgba(139,92,246,0.35)]" />
          </div>
        )}
        <div className="relative flex h-full flex-col justify-end p-6">{children}</div>
      </div>
    </section>
  );
}

/** Square illustration for empty states. */
export function EmptyArt({ src }: { src: string }) {
  return (
    <div className="frame mx-auto size-28 opacity-90">
      <div className="frame-body relative overflow-hidden">
        <Image src={src} alt="" fill sizes="112px" className="object-cover" />
      </div>
    </div>
  );
}
