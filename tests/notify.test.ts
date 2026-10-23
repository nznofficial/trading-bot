import { afterEach, describe, expect, it, vi } from "vitest";
import { COLORS, notify } from "@/lib/notify";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("notify", () => {
  it("is a no-op without a webhook", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("DISCORD_WEBHOOK_URL", "");
    await notify([{ title: "x", color: COLORS.error }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("batches embeds 10 per message and never throws", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("DISCORD_WEBHOOK_URL", "https://discord.example/webhook");
    const embeds = Array.from({ length: 12 }, (_, i) => ({ title: `e${i}`, color: COLORS.buy }));
    await expect(notify(embeds)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(first.embeds).toHaveLength(10);
  });
});
