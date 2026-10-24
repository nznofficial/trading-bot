import Link from "next/link";

/** Builds the link for a given page and page size (keeps whatever other query params the page needs). */
export type PageHref = (page: number, size: number) => string;

export const PAGE_SIZES = [5, 25, 100] as const;

const num = (v: string | string[] | undefined) => Math.floor(Number(Array.isArray(v) ? v[0] : v));

/** Read page/size from search params (falling back to page 1 and the smallest size). */
export function readPaging(page: string | string[] | undefined, size: string | string[] | undefined) {
  const s = (PAGE_SIZES as readonly number[]).includes(num(size)) ? num(size) : PAGE_SIZES[0];
  return { page: num(page) > 0 ? num(page) : 1, size: s };
}

/** Rows-per-page picker for a panel header: plain links, so it works without client JS. */
export function SizePicker({ size, href, label }: { size: number; href: PageHref; label: string }) {
  return (
    <nav aria-label={label} className="flex items-center gap-1">
      <span className="hud mr-1 hidden text-[11px] text-muted sm:inline">Show</span>
      {PAGE_SIZES.map((n) => (
        <Link
          key={n}
          href={href(1, n)}
          scroll={false}
          aria-current={n === size ? "page" : undefined}
          className={`hud border px-2 py-0.5 text-[11px] ${n === size ? "border-amber bg-amber text-[#0b0a10]" : "border-line-2 text-ink-2 hover:border-amber/60 hover:text-ink"}`}
        >
          {n}
        </Link>
      ))}
    </nav>
  );
}

/** Newer / Older paging under a newest-first list. */
export function Pager({ page, pages, size, href, label }: { page: number; pages: number; size: number; href: PageHref; label: string }) {
  if (pages <= 1) return null;
  const btn = "hud border px-3 py-1 text-[12px]";
  const live = `${btn} border-line-2 text-ink-2 hover:border-amber hover:text-amber`;
  const dead = `${btn} border-line text-muted/50`;
  return (
    <nav aria-label={label} className="mt-4 flex items-center justify-between gap-3">
      {page > 1 ? (
        <Link href={href(page - 1, size)} scroll={false} className={live}>
          ← Newer
        </Link>
      ) : (
        <span className={dead}>← Newer</span>
      )}
      <span className="hud text-[12px] text-muted">
        Page <span className="num text-ink">{page}</span> of <span className="num">{pages.toLocaleString()}</span>
        {page > 1 && (
          <Link href={href(1, size)} scroll={false} className="ml-3 text-amber hover:underline">
            Latest
          </Link>
        )}
      </span>
      {page < pages ? (
        <Link href={href(page + 1, size)} scroll={false} className={live}>
          Older →
        </Link>
      ) : (
        <span className={dead}>Older →</span>
      )}
    </nav>
  );
}
