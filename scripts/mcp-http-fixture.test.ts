import { describe, expect, it, vi } from "vitest";
import { cleanupMcpHttpFixture } from "./mcp-http-fixture";

const fixture = {
  ownerId: "bd0daa3c-8a46-4447-88a5-67267bff93fe",
  email: "mcp-http-disposable@example.invalid",
  password: "SYNTHETIC_FIXTURE_PASSWORD",
};
function setup(
  user: { id: string; email?: string | null } | null = {
    id: fixture.ownerId,
    email: fixture.email,
  },
) {
  return {
    getUser: vi.fn(async () => user),
    removeFiles: vi.fn(async () => undefined),
    deleteUser: vi.fn(async () => undefined),
  };
}

describe("অস্থায়ী MCP browser account সরানো", () => {
  it("server-এর পরিচয় মেলার পরেই ফাইল ও account সরায়", async () => {
    const cleanup = setup();
    await cleanupMcpHttpFixture(JSON.stringify(fixture), cleanup);
    expect(cleanup.getUser).toHaveBeenCalledWith(fixture.ownerId);
    expect(cleanup.removeFiles).toHaveBeenCalledWith(fixture.ownerId);
    expect(cleanup.deleteUser).toHaveBeenCalledWith(fixture.ownerId);
    expect(cleanup.getUser.mock.invocationCallOrder[0]).toBeLessThan(
      cleanup.removeFiles.mock.invocationCallOrder[0],
    );
    expect(cleanup.removeFiles.mock.invocationCallOrder[0]).toBeLessThan(
      cleanup.deleteUser.mock.invocationCallOrder[0],
    );
  });

  it.each([
    { ...fixture, ownerId: "../another-account" },
    { ...fixture, email: "real-user@example.com" },
    { ...fixture, password: "" },
    { ...fixture, unexpected: "value" },
  ])(
    "নষ্ট বা বাড়তি fixture তথ্য পেলে কোনো account-এ হাত দেয় না",
    async (invalid) => {
      const cleanup = setup();
      await expect(
        cleanupMcpHttpFixture(JSON.stringify(invalid), cleanup),
      ).rejects.toThrow();
      expect(cleanup.getUser).not.toHaveBeenCalled();
      expect(cleanup.removeFiles).not.toHaveBeenCalled();
      expect(cleanup.deleteUser).not.toHaveBeenCalled();
    },
  );

  it.each([
    { id: fixture.ownerId, email: "real-user@example.com" },
    { id: "fb317fd8-aa19-49bb-bbc4-e6c19b098f94", email: fixture.email },
    null,
  ])("fixture দিয়ে অন্য account-এর পরিচয় বসালে কিছু মুছে না", async (user) => {
    const cleanup = setup(user);
    await expect(
      cleanupMcpHttpFixture(JSON.stringify(fixture), cleanup),
    ).rejects.toThrow();
    expect(cleanup.removeFiles).not.toHaveBeenCalled();
    expect(cleanup.deleteUser).not.toHaveBeenCalled();
  });

  it("নষ্ট JSON-এর error-এ password দেখায় না", async () => {
    const cleanup = setup();
    let message = "";
    try {
      await cleanupMcpHttpFixture(
        `{"password":"${fixture.password}",`,
        cleanup,
      );
    } catch (error) {
      message = String(error);
    }
    expect(message).not.toContain(fixture.password);
    expect(message).toContain("তথ্য পড়া যায়নি");
    expect(cleanup.getUser).not.toHaveBeenCalled();
    expect(cleanup.deleteUser).not.toHaveBeenCalled();
  });

  it("পরিচয় যাচাই ব্যর্থ হলে password ছাপায় না বা কিছু মোছে না", async () => {
    const cleanup = setup();
    cleanup.getUser.mockRejectedValue(new Error(fixture.password));
    let message = "";
    try {
      await cleanupMcpHttpFixture(JSON.stringify(fixture), cleanup);
    } catch (error) {
      message = String(error);
    }
    expect(message).not.toContain(fixture.password);
    expect(message).toContain("যাচাই করা যায়নি");
    expect(cleanup.removeFiles).not.toHaveBeenCalled();
    expect(cleanup.deleteUser).not.toHaveBeenCalled();
  });
});
