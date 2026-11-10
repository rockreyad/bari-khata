// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { NEW_RECEIPT_MAX_BYTES } from "./attachmentLimits";
import { cropReceiptImage } from "./cropReceiptImage";

const fullImage = { left: 0, top: 0, right: 1, bottom: 1 };

function image(naturalWidth: number, naturalHeight: number) {
  return Object.defineProperties(document.createElement("img"), {
    naturalWidth: { value: naturalWidth },
    naturalHeight: { value: naturalHeight },
  });
}

function mockCanvas(...outputs: Blob[]) {
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage,
  } as unknown as CanvasRenderingContext2D);
  const encode = vi
    .spyOn(HTMLCanvasElement.prototype, "toBlob")
    .mockImplementation((callback) => callback(outputs.shift() ?? null));
  return { drawImage, encode };
}

afterEach(() => vi.restoreAllMocks());

it("preserves the original file when the full image is selected", async () => {
  const file = new File(["original"], "voucher.jpeg", { type: "image/jpeg" });
  const { drawImage } = mockCanvas();

  await expect(
    cropReceiptImage(file, image(800, 600), fullImage),
  ).resolves.toBe(file);
  expect(drawImage).not.toHaveBeenCalled();
});

it("crops the chosen pixels and retains the original image format and name", async () => {
  const file = new File(["original"], "voucher.PNG", {
    type: "image/png",
    lastModified: 42,
  });
  const photo = image(1200, 800);
  const { drawImage, encode } = mockCanvas(
    new Blob(["cropped"], { type: "image/png" }),
  );

  const result = await cropReceiptImage(file, photo, {
    left: 0.25,
    top: 0.125,
    right: 0.75,
    bottom: 0.875,
  });

  expect(drawImage).toHaveBeenCalledWith(
    photo,
    300,
    100,
    600,
    600,
    0,
    0,
    600,
    600,
  );
  expect(encode).toHaveBeenCalledWith(expect.any(Function), "image/png", 0.9);
  expect(result).toMatchObject({
    name: "voucher.PNG",
    type: "image/png",
    size: 7,
    lastModified: 42,
  });
});

it("bounds output size and uses the actual format if the encoder falls back", async () => {
  const file = new File(["original"], "voucher.webp", { type: "image/webp" });
  const photo = image(4800, 3600);
  const { drawImage } = mockCanvas(
    new Blob([new Uint8Array(NEW_RECEIPT_MAX_BYTES + 1)], {
      type: "image/png",
    }),
    new Blob(["cropped"], { type: "image/png" }),
  );

  const result = await cropReceiptImage(file, photo, {
    ...fullImage,
    bottom: 0.5,
  });

  expect(drawImage).toHaveBeenNthCalledWith(
    1,
    photo,
    0,
    0,
    4800,
    1800,
    0,
    0,
    2400,
    900,
  );
  expect(drawImage).toHaveBeenNthCalledWith(
    2,
    photo,
    0,
    0,
    4800,
    1800,
    0,
    0,
    2000,
    750,
  );
  expect(result).toMatchObject({ name: "voucher.png", type: "image/png" });
});

it("rejects unsupported sources or out-of-bounds crop coordinates", async () => {
  const photo = image(800, 600);
  const pdf = new File(["pdf"], "voucher.pdf", { type: "application/pdf" });
  const jpg = new File(["jpg"], "voucher.jpg", { type: "image/jpeg" });
  const { drawImage } = mockCanvas();

  await expect(cropReceiptImage(pdf, photo, fullImage)).rejects.toThrow(
    "receipt_crop_invalid",
  );
  await expect(
    cropReceiptImage(jpg, photo, { ...fullImage, right: 1.5 }),
  ).rejects.toThrow("receipt_crop_invalid");
  expect(drawImage).not.toHaveBeenCalled();
});
