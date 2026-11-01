export const themePalettes = [
  {
    value: "ocean",
    label: "নীলিমা",
    description: "আকাশের নীল, শান্তির ছোঁয়া",
    colors: ["#213555", "#3e5879", "#d8c4b6", "#f5efe7"],
    source: "https://colorhunt.co/palette/2135553e5879d8c4b6f5efe7",
    preview: {
      background: "#f1f4f8",
      surface: "#fcfdff",
      accent: "#3e5879",
      gradient: "linear-gradient(125deg, #e0e9f5, #f5efe7)",
    },
  },
  {
    value: "forest",
    label: "বনলতা",
    description: "সবুজে ঘেরা আপন ঘর",
    colors: ["#2c3930", "#3f4f44", "#a27b5c", "#dcd7c9"],
    source: "https://colorhunt.co/palette/2c39303f4f44a27b5cdcd7c9",
    preview: {
      background: "#f2f4ed",
      surface: "#fdfef9",
      accent: "#3f4f44",
      gradient: "linear-gradient(125deg, #dfe9dc, #eee6d8)",
    },
  },
  {
    value: "violet",
    label: "অপরাজিতা",
    description: "ফুলের রঙে নরম মায়া",
    colors: ["#441752", "#8174a0", "#a888b5", "#efb6c8"],
    source: "https://colorhunt.co/palette/4417528174a0a888b5efb6c8",
    preview: {
      background: "#f5f1f8",
      surface: "#fffaff",
      accent: "#70507d",
      gradient: "linear-gradient(125deg, #e8def1, #f8e5ec)",
    },
  },
  {
    value: "sunset",
    label: "গোধূলি",
    description: "বিকেলের রোদ, উষ্ণ আমেজ",
    colors: ["#2a1a0e", "#d4621a", "#f4ae52", "#fef3e2"],
    source: "https://colorhunt.co/palette/fef3e2f4ae52d4621a2a1a0e",
    preview: {
      background: "#faf3eb",
      surface: "#fffdf8",
      accent: "#9c4d20",
      gradient: "linear-gradient(125deg, #f8e1cb, #fff0d5)",
    },
  },
] as const;

export type ThemePalette = (typeof themePalettes)[number];
