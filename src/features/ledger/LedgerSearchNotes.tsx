import { useLanguageContext } from "../../context/LanguageProvider";
import type { LedgerSearchResult } from "./searchAnalytics";

export function LedgerSearchNotes({
  result,
  showCostContext = true,
}: {
  result: LedgerSearchResult;
  showCostContext?: boolean;
}) {
  const { t, number } = useLanguageContext();
  const groupAmbiguities = new Set(result.groupAmbiguousEntryIds);
  const otherAmbiguityCount = result.ambiguousEntryIds.filter(
    (id) => !groupAmbiguities.has(id),
  ).length;
  return (
    <>
      {otherAmbiguityCount > 0 ? (
        <p className="ledger-search-note" role="status">
          {t(
            "{{count}}টি বিল শুধু অন্য তথ্যে মিলেছে। সেগুলো খরচের মোটে ধরা হয়নি।",
            { count: number(otherAmbiguityCount) },
          )}
        </p>
      ) : null}
      {groupAmbiguities.size > 0 ? (
        <p className="ledger-search-note" role="status">
          {t(
            "কিছু লেখায় একাধিক মালের নাম বা ধরন মিলেছে। অস্পষ্ট অংশ এই মালের মোটে ধরা হয়নি।",
          )}
        </p>
      ) : null}
      {result.partiallyAmbiguousEntryIds.length > 0 ? (
        <p className="ledger-search-note" role="status">
          {t(
            "কিছু ফেরতের মালের পরিচয় মেলেনি। শুধু নিশ্চিত অংশ মোটে ধরা হয়েছে।",
          )}
        </p>
      ) : null}
      {showCostContext && result.unassignedAdjustmentCount > 0 ? (
        <p className="ledger-search-note">
          {t("মোট খরচে বিল ও মালের ফেরত আছে। আলাদা সমন্বয় এখানে যোগ করা হয়নি।")}
        </p>
      ) : null}
      {result.reviewEntryCount > 0 || result.historicalEntryCount > 0 ? (
        <p className="ledger-search-note">
          {[
            result.reviewEntryCount > 0
              ? t("{{count}}টি হিসাব যাচাই বাকি", {
                  count: number(result.reviewEntryCount),
                })
              : "",
            result.historicalEntryCount > 0
              ? t("{{count}}টি পুরোনো খরচের হিসাব আছে", {
                  count: number(result.historicalEntryCount),
                })
              : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      ) : null}
      {showCostContext &&
      result.costEntryCount === 0 &&
      result.entries.length > 0 ? (
        <p className="ledger-search-note">
          {t(
            "এই বাছাইয়ে খরচের বিল নেই। টাকা দেওয়ার রেকর্ড খরচে আবার যোগ হয় না।",
          )}
        </p>
      ) : null}
    </>
  );
}
