// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareReceiptFile } from "./prepareReceiptFile";
import {
  NEW_RECEIPT_MAX_BYTES,
  RECEIPT_IMAGE_SOURCE_MAX_BYTES,
} from "./attachmentLimits";

const decode = vi.fn();
const drawImage = vi.fn();
const fillRect = vi.fn();
const encoded: {
  width: number;
  height: number;
  quality: number | undefined;
}[] = [];
let outputs: (Blob | null)[];
let imageWidth: number;
let imageHeight: number;
let lastCanvas: HTMLCanvasElement;
const originalURL = URL;

function photo(size: number, type = "image/jpeg", name = "sample-receipt.jpg") {
  return new File([new Uint8Array(size)], name, { type, lastModified: 1234 });
}
beforeEach(() => {
  imageWidth = 4000;
  imageHeight = 3000;
  outputs = [new Blob([new Uint8Array(60 * 1024)], { type: "image/jpeg" })];
  encoded.length = 0;
  decode.mockResolvedValue(undefined);
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      naturalWidth = imageWidth;
      naturalHeight = imageHeight;
      decode = decode;
    },
  );
  vi.stubGlobal(
    "URL",
    class extends originalURL {
      static createObjectURL = vi.fn(() => "blob:sample-receipt");
      static revokeObjectURL = vi.fn();
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    fillStyle: "",
    fillRect,
    drawImage,
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    this: HTMLCanvasElement,
    callback,
    _type,
    quality,
  ) {
    lastCanvas = this;
    encoded.push({ width: this.width, height: this.height, quality });
    callback(outputs.shift() ?? null);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("receipt preparation", () => {
  it("compresses before applying the upload limit and keeps metadata in sync", async () => {
    const original = photo(6 * 1024 * 1024, "image/png", "sample-invoice.png");
    const result = await prepareReceiptFile(original);
    expect(result).toMatchObject({
      name: "sample-invoice.jpg",
      type: "image/jpeg",
      size: 60 * 1024,
      lastModified: 1234,
    });
    expect(encoded).toEqual([{ width: 2400, height: 1800, quality: 0.84 }]);
    expect(fillRect).toHaveBeenCalledWith(0, 0, 2400, 1800);
    expect(drawImage).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:sample-receipt");
    expect(lastCanvas.width).toBe(0);
    expect(lastCanvas.height).toBe(0);
    expect(original.size).toBe(6 * 1024 * 1024);
  });

  it("reduces dimensions again when the first encoding exceeds five MiB", async () => {
    outputs.unshift(
      new Blob([new Uint8Array(NEW_RECEIPT_MAX_BYTES + 1)], {
        type: "image/jpeg",
      }),
    );
    const result = await prepareReceiptFile(photo(7 * 1024 * 1024));
    expect(result.size).toBe(60 * 1024);
    expect(encoded.map(({ width, height }) => [width, height])).toEqual([
      [2400, 1800],
      [2000, 1500],
    ]);
  });

  it("does not upscale a small image or replace it with a bigger encoding", async () => {
    imageWidth = 800;
    imageHeight = 1200;
    outputs = [photo(300 * 1024)];
    const original = photo(200 * 1024);
    expect(await prepareReceiptFile(original)).toBe(original);
    expect(encoded[0]).toMatchObject({ width: 800, height: 1200 });
  });

  it("retains an already small photo without another lossy encoding", async () => {
    const original = photo(32 * 1024);
    expect(await prepareReceiptFile(original)).toBe(original);
    expect(decode).not.toHaveBeenCalled();
  });

  it("uses the actual output MIME and extension when the browser falls back to PNG", async () => {
    outputs = [new Blob([new Uint8Array(1000)], { type: "image/png" })];
    const result = await prepareReceiptFile(photo(300 * 1024));
    expect(result).toMatchObject({
      name: "sample-receipt.png",
      type: "image/png",
    });
  });

  it("preserves a PDF at the exact limit byte-for-byte and rejects a larger PDF", async () => {
    const original = photo(
      NEW_RECEIPT_MAX_BYTES,
      "application/pdf",
      "sample.pdf",
    );
    expect(await prepareReceiptFile(original)).toBe(original);
    await expect(
      prepareReceiptFile(photo(NEW_RECEIPT_MAX_BYTES + 1, "application/pdf")),
    ).rejects.toThrow("receipt_too_large");
    expect(decode).not.toHaveBeenCalled();
  });

  it("rejects unsupported, empty and excessive source files before decoding", async () => {
    await expect(
      prepareReceiptFile(photo(100, "image/svg+xml")),
    ).rejects.toThrow("receipt_type_invalid");
    await expect(prepareReceiptFile(photo(0))).rejects.toThrow("receipt_empty");
    await expect(
      prepareReceiptFile(photo(RECEIPT_IMAGE_SOURCE_MAX_BYTES + 1)),
    ).rejects.toThrow("receipt_source_too_large");
    expect(decode).not.toHaveBeenCalled();
  });

  it("releases a corrupt image source on decode failure", async () => {
    decode.mockRejectedValueOnce(new Error("invalid image"));
    await expect(prepareReceiptFile(photo(300 * 1024))).rejects.toThrow(
      "receipt_image_unreadable",
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
    expect(drawImage).not.toHaveBeenCalled();
  });

  it("rejects an excessive decoded pixel count without allocating a large canvas", async () => {
    imageWidth = 10000;
    imageHeight = 10000;
    await expect(prepareReceiptFile(photo(300 * 1024))).rejects.toThrow(
      "receipt_image_too_large",
    );
    expect(drawImage).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  });

  it.each([null, new Blob([]), new Blob(["invalid"], { type: "text/plain" })])(
    "rejects a missing or invalid encoding and cleans up",
    async (output) => {
      outputs = [output];
      await expect(prepareReceiptFile(photo(300 * 1024))).rejects.toThrow(
        "receipt_image_unreadable",
      );
      expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
    },
  );

  it("rejects an image when bounded compression cannot satisfy the cap", async () => {
    outputs = Array.from({ length: 3 }, () => photo(NEW_RECEIPT_MAX_BYTES + 1));
    await expect(prepareReceiptFile(photo(7 * 1024 * 1024))).rejects.toThrow(
      "receipt_too_large",
    );
    expect(encoded).toHaveLength(3);
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  });
});
