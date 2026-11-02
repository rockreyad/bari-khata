import { createContext, useContext } from "react";

export type Language = "bn" | "en";
export type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (text: string, values?: Record<string, string | number>) => string;
  money: (poisha: number, compact?: boolean) => string;
  number: (value: number) => string;
  formatDigits: (value: string | number) => string;
  date: (value: string | null, options?: Intl.DateTimeFormatOptions) => string;
};
export const LanguageContext = createContext<LanguageContextValue | null>(null);

export function useLanguageContext() {
  const value = useContext(LanguageContext);
  if (!value) throw new Error("LanguageProvider is missing");
  return value;
}
