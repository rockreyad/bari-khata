import {
  LanguageContext,
  type Language,
  type LanguageContextValue,
} from "./LanguageContext";
export { useLanguageContext } from "./LanguageContext";
import { entryFlowEnglish, compactCopy } from "./entryFlowEnglish";
import { worksRefreshEnglish } from "../features/works/worksRefreshEnglish";
import { deletionEnglish } from "../components/ui/deletionEnglish";
import { accountEnglish } from "../features/settings/accountEnglish";
import { loginRefreshEnglish } from "../features/auth/loginRefreshEnglish";
import { navigationRefreshEnglish } from "./navigationRefreshEnglish";
import { jobsEnglish } from "../features/jobs/jobsEnglish";
import { jobFormEnglish } from "../components/jobFormEnglish";
import { v21EntryEnglish } from "../features/entries/v21EntryEnglish";
import { entryPageEnglish } from "../features/entries/entryPageEnglish";
import { cashOverviewEnglish } from "./cashOverviewEnglish";
import { cashReportEnglish } from "../features/analytics/cashReportEnglish";
import { formatMoney } from "../lib/formatMoney";
import { settingsPasswordEnglish } from "../features/settings/settingsPasswordEnglish";
import { localizedDigits } from "../lib/numerals";
import { spendingEnglish } from "../components/ui/spendingEnglish";
import { spendingChartEnglish } from "../components/ui/spendingChartEnglish";
import { contactImportEnglish } from "../components/contacts/contactImportEnglish";
import { phoneAuthEnglish } from "../features/auth/phoneAuthEnglish";
import { authRegistrationEnglish } from "../features/auth/authRegistrationEnglish";
import { historyV4English } from "../features/history/historyV4English";
import { entriesV4English } from "../features/entries/entriesV4English";
import { sharedEnglish } from "../features/sharing/sharedEnglish";
import { integrationsEnglish } from "../features/integrations/integrationsEnglish";
import {
  useCallback,
  useMemo,
  useState,
  useEffect,
  type ReactNode,
} from "react";

import { v4English } from "./v4English";
import { v3English } from "./v3English";
import { controlsEnglish } from "../components/ui/controlsEnglish";
import { historyReportsEnglish } from "../features/history/historyReportsEnglish";
import { adjustmentEnglish } from "../features/history/adjustmentEnglish";
import { balanceAdjustmentEnglish } from "../features/reconciliation/balanceAdjustmentEnglish";
import { v2English } from "./v2English";
import { authEnglish } from "../features/auth/authEnglish";
import { settingsEnglish } from "../features/settings/settingsEnglish";
import { peopleEnglish } from "../features/people/peopleEnglish";
import { contactPresetsEnglish } from "../features/people/contactPresetsEnglish";
import { reviewEnglish } from "../features/import/reviewEnglish";
import { analyticsEnglish } from "../features/analytics/analyticsEnglish";
import { formEnglish } from "./formEnglish";
import { architectureEnglish } from "./architectureEnglish";
import { houseWriteEnglish } from "../features/write/houseWriteEnglish";
import { entityNavigationEnglish } from "./entityNavigationEnglish";
import { appEnglish } from "./appEnglish";
import {
  applyTheme,
  applyPalette,
  readPreferences,
  savePreferences,
} from "../lib/preferences";

const english: Record<string, string> = {
  ...entityNavigationEnglish,
  ...houseWriteEnglish,
  ...architectureEnglish,
  ...entryFlowEnglish,
  ...v21EntryEnglish,
  ...jobsEnglish,
  ...jobFormEnglish,
  ...navigationRefreshEnglish,
  ...loginRefreshEnglish,
  ...accountEnglish,
  ...deletionEnglish,
  ...worksRefreshEnglish,
  ...entryPageEnglish,
  ...cashReportEnglish,
  ...cashOverviewEnglish,
  ...spendingEnglish,
  ...spendingChartEnglish,
  ...settingsPasswordEnglish,
  ...contactImportEnglish,
  ...v3English,
  ...v4English,
  ...historyV4English,
  ...entriesV4English,
  ...sharedEnglish,
  ...integrationsEnglish,
  ...controlsEnglish,
  ...historyReportsEnglish,
  ...adjustmentEnglish,
  ...balanceAdjustmentEnglish,
  ...analyticsEnglish,
  ...reviewEnglish,
  ...authEnglish,
  ...authRegistrationEnglish,
  ...phoneAuthEnglish,
  ...settingsEnglish,
  ...peopleEnglish,
  ...contactPresetsEnglish,
  ...v2English,
  ...formEnglish,
  ...appEnglish,
  "বাড়ির খাতা": "Bari Khata",
  "আমার বাড়ি": "My home",
  "নিজের হিসাব, নিজের মতো": "Your home, every little detail",
  "এক নজরে": "Overview",
  কাজ: "Works",
  খাতা: "Ledger",
  ব্যক্তি: "People",
  রিপোর্ট: "Reports",
  সেটিংস: "Settings",
  "নতুন হিসাব": "Add entry",
  "নতুন কাজ": "New work",
  "নতুন ব্যক্তি": "New person",
  "সব দেখুন": "View all",
  "কাজের খাতা": "Work notebooks",
  "সাম্প্রতিক হিসাব": "Recent entries",
  "মোট খরচ": "Recorded cost",
  "এ পর্যন্ত দিয়েছি": "Money paid",
  "দিতে হবে": "Payable now",
  "তার কাছে টাকা আছে": "Money held for you",
  "ফোনে সংরক্ষিত": "Saved on this device",
  "নমুনা হিসাব": "Sample notebook",
  "নিজের হিসাবে ফিরুন": "Open my notebook",
  "নমুনা দেখুন": "Explore sample",
  "নমুনার তথ্য দিয়ে app ঘুরে দেখছেন। নিজের হিসাব সম্পূর্ণ আলাদা।":
    "You are exploring sample data. Your own notebook stays separate.",
  "সব কাজ": "All works",
  "সব ধরনের": "All types",
  খুঁজুন: "Search",
  মালামাল: "Materials",
  মজুরি: "Labour",
  গাড়িভাড়া: "Transport",
  "মাল নামানো": "Unloading",
  ভাড়া: "Rentals",
  অন্যান্য: "Other",
  "মাল কিনেছি": "Bought materials",
  "টাকা দিয়েছি": "Paid someone",
  "মজুরির হিসাব": "Work bill",
  "টাকা ফেরত পেয়েছি": "Money returned",
  "মাল ফেরত দিয়েছি": "Returned materials",
  চলছে: "In progress",
  শেষ: "Complete",
  "এখনও শুরু হয়নি": "Not started",
  খরচ: "Cost",
  "বন্ধ করুন": "Close",
  "সংরক্ষণ করুন": "Save",
  বাতিল: "Cancel",
  "যোগ করুন": "Add",
  পেছনে: "Back",
  "তারিখ জানা নেই": "Date unknown",
  "কেউ নেই": "No one yet",
  "কোনো হিসাব পাওয়া যায়নি": "No entries found",
  "আজকের ছোট হিসাব, আগামী দিনের নিশ্চিন্তি।":
    "Small entries today. A clearer picture tomorrow.",
  "আপনার বাড়ির গল্প, এক খাতায়।": "The story of your home, in one notebook.",
  "প্রথম কাজের খাতা খুলুন": "Start your first work notebook",
  "টাইলস, রং বা পানির লাইন—যে কাজের হিসাব রাখতে চান, তার নাম দিন।":
    "Name a work you want to track, like tiles, painting or plumbing.",
  "এখনও কোনো হিসাব লেখা হয়নি": "Your first entry starts here",
  "মাল কেনা বা কাউকে টাকা দেওয়া থেকে শুরু করুন।":
    "Start with a purchase or a payment.",
  "মাল কেনা": "Purchase",
  "টাকা দেওয়া": "Payment",
  "সব হিসাব": "All entries",
  চুক্তি: "Agreement",
  "মোট চুক্তি": "Agreed amount",
  "চুক্তির অবশিষ্ট": "Contract remaining",
  "চুক্তি যোগ করুন": "Add agreement",
  "হিসাবের বিস্তারিত": "Entry details",
  "মূল খরচ": "Purchase value",
  "নাম বা নোট লিখে খুঁজুন": "Search a name or note",
  "রপ্তানি করুন": "Export CSV",
  "এই মাসে": "This month",
  "সব সময়": "All time",
  "কোথায় কত খরচ": "Where your money went",
  "মালামালের হিসাব": "Materials breakdown",
  "দরকারি সব হিসাব, হাতের মুঠোয়।": "Every detail, right at hand.",
  "নিজের খাতা": "My notebook",
  "মালামাল ও মজুরি মিলিয়ে": "Materials and work bills",
  "কেনাকাটা ও কিস্তির টাকা": "Purchases and instalments",
  "বিলের বিপরীতে এখনও দিতে হবে": "Outstanding against recorded bills",
  "প্রথমে একটি কাজ যোগ করুন": "Add a work first",
  "আপনার খাতা প্রস্তুত": "Your notebook is ready",
  বাংলা: "বাংলা",
  English: "English",
  আলো: "Light",
  অন্ধকার: "Dark",
  "ফোনের মতো": "Use device setting",
};

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => {
    const prefs = readPreferences();
    applyTheme(prefs.theme);
    applyPalette(prefs.palette);
    return prefs.language;
  });
  useEffect(() => {
    document.documentElement.lang = language;
    savePreferences({ language });
  }, [language]);
  const locale = language === "bn" ? "bn-BD" : "en-BD";
  const t = useCallback(
    (text: string, values: Record<string, string | number> = {}) => {
      const source = compactCopy[text] ?? text;
      let translated =
        language === "en"
          ? (english[source] ?? english[text] ?? source)
          : source;
      for (const [key, value] of Object.entries(values))
        translated = translated.replaceAll(`{{${key}}}`, String(value));
      return localizedDigits(
        language === "bn"
          ? translated.replaceAll("আগাম", "অগ্রিম").replaceAll("বোতাম", "বাটন")
          : translated,
        language,
      );
    },
    [language],
  );
  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      setLanguage,
      t,
      formatDigits: (value) => localizedDigits(value, language),
      money: (poisha, compact = false) =>
        formatMoney(poisha, language, compact),
      number: (value) =>
        localizedDigits(
          new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(
            value,
          ),
          language,
        ),
      date: (date, options) => {
        if (!date) return t("তারিখ জানা নেই");
        const value = new Date(
          date.length > 10 ? date : `${date}T12:00:00+06:00`,
        );
        return Number.isFinite(value.getTime())
          ? localizedDigits(
              new Intl.DateTimeFormat(locale, {
                timeZone: "Asia/Dhaka",
                day: "numeric",
                month: "short",
                ...options,
              }).format(value),
              language,
            )
          : t("তারিখ জানা নেই");
      },
    }),
    [language, locale, t],
  );
  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}
