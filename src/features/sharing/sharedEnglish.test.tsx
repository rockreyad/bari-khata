// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  LanguageProvider,
  useLanguageContext,
} from "../../context/LanguageProvider";
import { savePreferences } from "../../lib/preferences";

afterEach(() => {
  cleanup();
  localStorage.clear();
});
it("translates all static shared-page and detail copy through the real English language provider", () => {
  const copy = new Set<string>();
  for (const file of [
    "SharedStatementPage.tsx",
    "SharedContractCarousel.tsx",
    "SharedMonthlyChart.tsx",
    "SharedEntryDetail.tsx",
    "ShareLinkControls.tsx",
    "../people/StatementSheet.tsx",
  ]) {
    const source = ts.createSourceFile(
      file,
      readFileSync(new URL(file, import.meta.url), "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const visit = (node: ts.Node) => {
      if (
        (ts.isStringLiteral(node) ||
          ts.isNoSubstitutionTemplateLiteral(node)) &&
        /[\u0980-\u09ff]/u.test(node.text)
      )
        copy.add(node.text);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  const missing: string[] = [];
  function Probe() {
    const { t } = useLanguageContext();
    for (const text of copy)
      if (/[\u0980-\u09ff]/u.test(t(text))) missing.push(text);
    return null;
  }
  savePreferences({ language: "en" });
  render(
    <LanguageProvider>
      <Probe />
    </LanguageProvider>,
  );
  expect(copy.size).toBeGreaterThan(30);
  expect([...new Set(missing)]).toEqual([]);
});
