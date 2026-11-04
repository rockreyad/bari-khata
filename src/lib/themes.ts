export const themePalettes = [
  {
    value: "ocean",
    label: "নীলিমা",
    description: "গভীর নীল, পরিচ্ছন্ন হিসাব",
    colors: ["#18457f", "#235fad", "#a7c7ff", "#f4f6f9"],
    source: "https://coolors.co/18457f-235fad-a7c7ff-f4f6f9",
  },
  {
    value: "forest",
    label: "বনলতা",
    description: "জলপাই সবুজ, মাটির কাছাকাছি",
    colors: ["#394720", "#526231", "#c1d29a", "#f5f6f1"],
    source: "https://coolors.co/394720-526231-c1d29a-f5f6f1",
  },
  {
    value: "violet",
    label: "অপরাজিতা",
    description: "শীতল বেগুনি, স্বতন্ত্র ছোঁয়া",
    colors: ["#452779", "#6545a0", "#c7b3f2", "#f5f4f8"],
    source: "https://coolors.co/452779-6545a0-c7b3f2-f5f4f8",
  },
  {
    value: "sunset",
    label: "গোধূলি",
    description: "খয়েরি রোদ, নরম উষ্ণতা",
    colors: ["#703b1c", "#965327", "#e6bf94", "#f8f5f1"],
    source: "https://coolors.co/703b1c-965327-e6bf94-f8f5f1",
  },
  {
    value: "winter",
    label: "হিমেল",
    description: "বরফমাখা জলসবুজ, শান্ত সকাল",
    colors: ["#124a45", "#176b64", "#a6dcd3", "#f1f7f5"],
    source: "https://coolors.co/124a45-176b64-a6dcd3-f1f7f5",
  },
  {
    value: "rose",
    label: "কালি",
    description: "ধূসর কালিতে সরল সৌন্দর্য",
    colors: ["#252a32", "#41464f", "#d8dce3", "#f3f4f5"],
    source: "https://coolors.co/252a32-41464f-d8dce3-f3f4f5",
  },
] as const;

export type ThemePalette = (typeof themePalettes)[number];
export const paletteIds = themePalettes.map((palette) => palette.value) as [
  ThemePalette["value"],
  ...ThemePalette["value"][],
];
