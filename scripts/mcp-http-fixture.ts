import { z } from "zod";

const Fixture = z.strictObject({
  ownerId: z.uuid(),
  email: z.string().regex(/^mcp-http-[\w-]+@example\.invalid$/),
  password: z.string().min(1).max(1024),
});

export type FixtureCleanup = {
  getUser: (
    id: string,
  ) => Promise<{ id: string; email?: string | null } | null>;
  removeFiles: (id: string) => Promise<void>;
  deleteUser: (id: string) => Promise<void>;
};

export async function cleanupMcpHttpFixture(
  text: string,
  cleanup: FixtureCleanup,
) {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("অস্থায়ী পরীক্ষার তথ্য পড়া যায়নি।");
  }
  const parsed = Fixture.safeParse(value);
  if (!parsed.success) throw new Error("অস্থায়ী পরীক্ষার তথ্য ঠিক নেই।");
  const fixture = parsed.data;
  let user: { id: string; email?: string | null } | null;
  try {
    user = await cleanup.getUser(fixture.ownerId);
  } catch {
    throw new Error("অস্থায়ী পরীক্ষার account যাচাই করা যায়নি।");
  }
  if (!user || user.id !== fixture.ownerId || user.email !== fixture.email)
    throw new Error("অস্থায়ী পরীক্ষার account-এর পরিচয় মেলেনি।");
  await cleanup.removeFiles(fixture.ownerId);
  await cleanup.deleteUser(fixture.ownerId);
}
