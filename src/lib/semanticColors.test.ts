import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { themePalettes } from "./themes";

type RGB = [number, number, number];
type Rule = {
  selector: string;
  media: string[];
  declarations: Map<string, string>;
};
type Appearance = {
  palette: string;
  mode: "light" | "dark" | "system";
  deviceDark: boolean;
};
const theme = readFileSync(new URL("../theme.css", import.meta.url), "utf8");
const workStyles = ["../styles-v2.css", "../styles-v3.css"].map((path) =>
  readFileSync(new URL(path, import.meta.url), "utf8"),
);
const semantic = readFileSync(
  new URL("../semantic-colors.css", import.meta.url),
  "utf8",
);
const progress = readFileSync(
  new URL("../components/ui/balance-progress.css", import.meta.url),
  "utf8",
);

function rules(source: string, media: string[] = []): Rule[] {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const found: Rule[] = [];
  let cursor = 0;
  while (cursor < css.length) {
    const open = css.indexOf("{", cursor);
    if (open < 0) break;
    const selector = css.slice(cursor, open).trim();
    let depth = 1,
      end = open + 1;
    while (depth && end < css.length) {
      if (css[end] === "{") depth++;
      if (css[end] === "}") depth--;
      end++;
    }
    if (depth) throw new Error("Unclosed CSS rule");
    const body = css.slice(open + 1, end - 1);
    if (selector.startsWith("@media"))
      found.push(...rules(body, [...media, selector]));
    else if (!selector.startsWith("@"))
      found.push({
        selector,
        media,
        declarations: new Map(
          [...body.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map((match) => [
            match[1],
            match[2].trim(),
          ]),
        ),
      });
    cursor = end;
  }
  return found;
}
const workRules = workStyles.flatMap((source) => rules(source));
const rootRules = [...workRules, ...rules(theme), ...rules(semantic)];
const progressRules = rules(progress);
const workMarkColors = workRules
  .filter((rule) => /^\.(work-mark|tone-[\w-]+)$/.test(rule.selector))
  .map(({ selector, declarations }) => {
    const foreground = declarations.get("color");
    const background = declarations.get("background");
    if (!foreground || !background)
      throw new Error(`Missing work mark colors: ${selector}`);
    return { selector, foreground, background };
  });

function matchesRoot(selector: string, appearance: Appearance) {
  const explicit = appearance.mode === "system" ? undefined : appearance.mode;
  let matches = true;
  const root = selector
    .replace(
      /:not\(\[data-theme=["']?(light|dark)["']?\]\)/g,
      (_, value: string) => {
        if (value === explicit) matches = false;
        return "";
      },
    )
    .replace(
      /\[data-(theme|palette)=["']?([\w-]+)["']?\]/g,
      (_, name: string, value: string) => {
        if (value !== (name === "theme" ? explicit : appearance.palette))
          matches = false;
        return "";
      },
    );
  return matches && (root === ":root" || root === "html:root");
}

function tokensFor(appearance: Appearance) {
  const values = new Map<string, string>();
  const priorities = new Map<string, number>();
  for (const rule of rootRules) {
    if (
      rule.media.some(
        (condition) =>
          !condition.includes("prefers-color-scheme: dark") ||
          !appearance.deviceDark,
      )
    )
      continue;
    for (const selector of rule.selector
      .split(",")
      .map((part) => part.trim())) {
      if (!matchesRoot(selector, appearance)) continue;
      const specificity =
        (selector.match(/:root|\[/g)?.length ?? 0) +
        (selector.startsWith("html") ? 0.01 : 0);
      for (const [name, value] of rule.declarations) {
        if (!name.startsWith("--") || specificity < (priorities.get(name) ?? 0))
          continue;
        values.set(name, value);
        priorities.set(name, specificity);
      }
    }
  }
  return values;
}

function parts(value: string) {
  const result: string[] = [];
  let depth = 0,
    start = 0;
  for (let index = 0; index < value.length; index++) {
    if (value[index] === "(") depth++;
    if (value[index] === ")") depth--;
    if (value[index] === "," && depth === 0) {
      result.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  return [...result, value.slice(start).trim()];
}

function color(
  value: string,
  tokens: Map<string, string>,
  seen = new Set<string>(),
): RGB {
  const text = value.replace(/\s+/g, " ").trim();
  const variable = text.match(/^var\((--[\w-]+)\)$/);
  if (variable) {
    const name = variable[1],
      next = tokens.get(name);
    if (!next || seen.has(name))
      throw new Error(`Missing or circular token ${name}`);
    return color(next, tokens, new Set([...seen, name]));
  }
  if (/^#[\da-f]{6}$/i.test(text))
    return [1, 3, 5].map(
      (index) => parseInt(text.slice(index, index + 2), 16) / 255,
    ) as RGB;
  if (/^#[\da-f]{3}$/i.test(text))
    return [1, 2, 3].map(
      (index) => parseInt(text[index].repeat(2), 16) / 255,
    ) as RGB;
  if (text.startsWith("color-mix(") && text.endsWith(")")) {
    const [space, left, right] = parts(text.slice(10, -1));
    if (space !== "in srgb" || !left || !right)
      throw new Error(`Unsupported color mix ${text}`);
    const first = left.match(/^(.*) ([\d.]+)%$/),
      second = right.match(/^(.*) ([\d.]+)%$/);
    const firstWeight = first
      ? Number(first[2]) / 100
      : second
        ? 1 - Number(second[2]) / 100
        : 0.5;
    const secondWeight = second ? Number(second[2]) / 100 : 1 - firstWeight;
    if (Math.abs(firstWeight + secondWeight - 1) > 0.00001)
      throw new Error(`Non-opaque mix ${text}`);
    const a = color(first?.[1] ?? left, tokens, seen),
      b = color(second?.[1] ?? right, tokens, seen);
    return a.map(
      (channel, index) => channel * firstWeight + b[index] * secondWeight,
    ) as RGB;
  }
  throw new Error(`Unsupported CSS color ${text}`);
}

function luminance(rgb: RGB) {
  const linear = rgb.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}
function contrast(first: RGB, second: RGB) {
  const a = luminance(first),
    b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function resolve(
  value: string,
  tokens: Map<string, string>,
  seen = new Set<string>(),
): string {
  return value.replace(/var\((--[\w-]+)\)/g, (_, name: string) => {
    const next = tokens.get(name);
    if (!next || seen.has(name))
      throw new Error(`Missing or circular token ${name}`);
    return resolve(next, tokens, new Set([...seen, name]));
  });
}

function gradientSamples(value: string, tokens: Map<string, string>): RGB[] {
  const resolved = resolve(value, tokens).replace(/\s+/g, " ").trim();
  if (!resolved.startsWith("linear-gradient(") || !resolved.endsWith(")"))
    throw new Error(`Expected a linear gradient: ${resolved}`);
  const stops = parts(resolved.slice(16, -1))
    .slice(1)
    .map((stop) => color(stop.replace(/\s+[\d.]+%$/, ""), tokens));
  if (stops.length < 2) throw new Error(`Missing gradient stops: ${resolved}`);
  return stops.flatMap((stop, index) => {
    const next = stops[index + 1];
    if (!next) return [stop];
    return Array.from({ length: 21 }, (_, sample) => {
      const fraction = sample / 20;
      return stop.map(
        (channel, channelIndex) =>
          channel * (1 - fraction) + next[channelIndex] * fraction,
      ) as RGB;
    });
  });
}

const states = [
  "expense",
  "paid",
  "due",
  "advance",
  "refund",
  "credit",
  "ongoing",
  "done",
  "planned",
  "unknown",
  "voided",
];
const appearances = themePalettes.flatMap(({ value: palette }) =>
  (["light", "dark", "system"] as const).flatMap((mode) =>
    [false, true].map((deviceDark) => ({ palette, mode, deviceDark })),
  ),
);
const property = (selector: string, name: string) => {
  const value = progressRules
    .find((rule) => rule.selector === selector)
    ?.declarations.get(name);
  if (!value) throw new Error(`Missing ${selector} ${name}`);
  return value;
};
const selectedControlColors = [
  {
    path: "../features/entries/entry-page.css",
    selectors: [
      '.entry-page-form .expense-sections > button[aria-pressed="true"]',
      ".entry-intent-options > button.selected",
    ],
  },
  {
    path: "../styles-v2.css",
    selectors: [
      ".choice-chips button.selected",
      ".payment-methods > button.selected",
    ],
  },
  {
    path: "../styles-v3.css",
    selectors: [".small-switch > button.selected"],
  },
  {
    path: "../features/people/people-role-tabs.css",
    selectors: [".contacts-tabs.people-role-tabs > button.active"],
  },
  {
    path: "../components/ui/controls.css",
    selectors: ['.app-select-option[data-state="checked"]'],
  },
].flatMap(({ path, selectors }) => {
  const stylesheet = rules(
    readFileSync(new URL(path, import.meta.url), "utf8"),
  );
  return selectors.map((selector) => {
    const foreground = stylesheet
      .find((rule) => rule.selector === selector)
      ?.declarations.get("color");
    if (!foreground)
      throw new Error(`Missing selected text color: ${selector}`);
    return { selector, foreground };
  });
});

describe("semantic state color contrast", () => {
  it("uses the WCAG sRGB contrast formula without rounding threshold values", () => {
    expect(contrast([0, 0, 0], [1, 1, 1])).toBe(21);
    expect(contrast(color("#777777", new Map()), [1, 1, 1])).toBeLessThan(4.5);
    expect(contrast(color("#767676", new Map()), [1, 1, 1])).toBeGreaterThan(
      4.5,
    );
  });

  it.each(appearances)(
    "keeps actual work mark icons distinguishable for $palette / $mode / deviceDark=$deviceDark",
    (appearance) => {
      const tokens = tokensFor(appearance);
      for (const { selector, foreground, background } of workMarkColors)
        expect(
          contrast(color(foreground, tokens), color(background, tokens)),
          `${selector} icon on its own background`,
        ).toBeGreaterThanOrEqual(3);
    },
  );

  it.each(themePalettes)(
    "keeps work mark colors consistent between explicit and system modes for $value",
    ({ value: palette }) => {
      for (const dark of [false, true]) {
        const system = tokensFor({ palette, mode: "system", deviceDark: dark });
        const explicit = tokensFor({
          palette,
          mode: dark ? "dark" : "light",
          deviceDark: !dark,
        });
        for (const { selector, foreground, background } of workMarkColors)
          for (const value of [foreground, background])
            expect(
              color(value, system),
              `${selector} system/explicit parity`,
            ).toEqual(color(value, explicit));
      }
    },
  );

  it.each(appearances)(
    "keeps body, supporting and placeholder text readable for $palette / $mode / deviceDark=$deviceDark",
    (appearance) => {
      const tokens = tokensFor(appearance);
      for (const foreground of [
        "--text",
        "--muted",
        "--placeholder",
        "--accent",
        "--accent-strong",
      ])
        for (const background of [
          "--bg",
          "--surface",
          "--surface-muted",
          "--accent-soft",
        ])
          expect(
            contrast(
              color(`var(${foreground})`, tokens),
              color(`var(${background})`, tokens),
            ),
            `${foreground} on ${background}`,
          ).toBeGreaterThanOrEqual(4.5);
      for (const foreground of [
        "--text",
        "--muted",
        "--accent",
        "--accent-strong",
      ])
        for (const [index, background] of gradientSamples(
          "var(--hero-gradient)",
          tokens,
        ).entries())
          expect(
            contrast(color(`var(${foreground})`, tokens), background),
            `${foreground} on hero gradient sample ${index}`,
          ).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(appearances)(
    "keeps primary button labels readable through normal and hover gradients for $palette / $mode / deviceDark=$deviceDark",
    (appearance) => {
      const tokens = tokensFor(appearance);
      const ink = color("var(--primary-ink)", tokens);
      for (const gradient of ["--primary-gradient", "--primary-gradient-hover"])
        for (const [index, background] of gradientSamples(
          `var(${gradient})`,
          tokens,
        ).entries())
          expect(
            contrast(ink, background),
            `primary ink on ${gradient} sample ${index}`,
          ).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(appearances)(
    "keeps field boundaries, focus rings and selected text distinguishable for $palette / $mode / deviceDark=$deviceDark",
    (appearance) => {
      const tokens = tokensFor(appearance);
      for (const foreground of ["--control-border", "--focus-ring"])
        for (const background of [
          "--bg",
          "--surface",
          "--surface-muted",
          "--accent-soft",
        ])
          expect(
            contrast(
              color(`var(${foreground})`, tokens),
              color(`var(${background})`, tokens),
            ),
            `${foreground} on ${background}`,
          ).toBeGreaterThanOrEqual(3);
      expect(
        contrast(
          color("var(--selection-ink)", tokens),
          color("var(--selection-bg)", tokens),
        ),
        "selected text on highlight",
      ).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(appearances)(
    "keeps normal state text legible for $palette / $mode / deviceDark=$deviceDark",
    (appearance) => {
      const tokens = tokensFor(appearance);
      for (const state of states) {
        const foreground = color(`var(--state-${state})`, tokens);
        for (const background of [
          "--bg",
          "--surface",
          "--surface-muted",
          `--state-${state}-soft`,
        ]) {
          expect(
            contrast(foreground, color(`var(${background})`, tokens)),
            `${state} on ${background}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    },
  );

  it.each(appearances)(
    "keeps actual selected control text legible on neutral surfaces for $palette / $mode / deviceDark=$deviceDark",
    (appearance) => {
      const tokens = tokensFor(appearance);
      for (const { selector, foreground } of selectedControlColors)
        for (const surface of ["--surface", "--surface-muted"])
          expect(
            contrast(
              color(foreground, tokens),
              color(`var(${surface})`, tokens),
            ),
            `${selector} on ${surface}`,
          ).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(themePalettes)(
    "keeps system and explicit mode aliases consistent for $value",
    ({ value: palette }) => {
      for (const dark of [false, true]) {
        const system = tokensFor({ palette, mode: "system", deviceDark: dark });
        const explicit = tokensFor({
          palette,
          mode: dark ? "dark" : "light",
          deviceDark: !dark,
        });
        for (const token of [
          "--bg",
          "--surface",
          "--surface-muted",
          "--text",
          "--muted",
          "--line",
          "--accent",
          "--accent-strong",
          "--accent-soft",
          "--primary-ink",
          "--control-border",
          "--focus-ring",
          "--placeholder",
          "--selection-bg",
          "--selection-ink",
        ])
          expect(
            color(`var(${token})`, system),
            `${token} system/explicit parity`,
          ).toEqual(color(`var(${token})`, explicit));
        for (const token of [
          "--hero-gradient",
          "--primary-gradient",
          "--primary-gradient-hover",
        ])
          expect(
            gradientSamples(`var(${token})`, system),
            `${token} system/explicit parity`,
          ).toEqual(gradientSamples(`var(${token})`, explicit));
        for (const state of states) {
          expect(color(`var(--state-${state})`, system)).toEqual(
            color(`var(--state-${state})`, explicit),
          );
          expect(color(`var(--state-${state}-soft)`, system)).toEqual(
            color(`var(--state-${state}-soft)`, explicit),
          );
          if (dark)
            expect(color(`var(--state-${state})`, explicit)).toEqual(
              color(`var(--state-${state}-night)`, explicit),
            );
        }
        for (const [alias, state] of [
          ["danger", "voided"],
          ["warning", "due"],
          ["success", "done"],
          ["info", "ongoing"],
          ["purple", "credit"],
        ])
          expect(color(`var(--${alias})`, system)).toEqual(
            color(`var(--state-${state})`, system),
          );
      }
    },
  );

  it.each(appearances)(
    "keeps the actual progress fill distinguishable for $palette / $mode / deviceDark=$deviceDark",
    (appearance) => {
      const tokens = tokensFor(appearance);
      const track = color(
        property(".balance-progress-track", "background"),
        tokens,
      );
      const fill = property(".balance-progress-track > span", "background");
      const stops = fill.startsWith("linear-gradient(")
        ? parts(fill.slice(16, -1)).slice(1)
        : [fill];
      for (const stop of stops)
        expect(
          contrast(color(stop, tokens), track),
          `${stop} on the progress track`,
        ).toBeGreaterThanOrEqual(3);
    },
  );

  it("loads semantic tokens after the legacy theme stylesheet", () => {
    const main = readFileSync(new URL("../main.tsx", import.meta.url), "utf8");
    const themeImport = main.indexOf('import "./theme.css"'),
      semanticImport = main.indexOf('import "./semantic-colors.css"');
    expect(themeImport).toBeGreaterThanOrEqual(0);
    expect(semanticImport).toBeGreaterThan(themeImport);
  });
});
