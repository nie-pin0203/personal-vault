import { afterEach, describe, it, expect, vi } from "vitest";
import { writeClipboard } from "../src/clipboard";
afterEach(() => vi.unstubAllGlobals());
describe("clipboard", () => {
  it.each(["example-account", "test-password"])(
    "writes a requested field through Clipboard API",
    async (value) => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal("navigator", { clipboard: { writeText } });
      await writeClipboard(value);
      expect(writeText).toHaveBeenCalledWith(value);
    },
  );
  it("explains unsupported browsers", async () => {
    vi.stubGlobal("navigator", {});
    await expect(writeClipboard("test")).rejects.toThrow("手动选择复制");
  });
  it("explains denied permission and retry", async () => {
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error("NotAllowedError")),
      },
    });
    await expect(writeClipboard("test")).rejects.toThrow("再次点击复制");
  });
});
