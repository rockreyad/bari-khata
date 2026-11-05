import { useParams, useSearchParams } from "react-router";
import { QuickActionsSheet } from "../entries/QuickActionsSheet";
import { HouseCostForm } from "./HouseCostForm";
import { HousePaymentForm } from "./HousePaymentForm";
import "./house-write.css";
import { AccountSchema } from "../../domain/model";

export function HouseWriteChooser() {
  const [params] = useSearchParams();
  return (
    <QuickActionsSheet
      partyPayment={
        params.get("purpose") === "party-payment"
          ? {
              personId: params.get("person") ?? "",
              workId: params.get("work") ?? undefined,
              account: AccountSchema.safeParse(params.get("account")).data,
              contractId: params.get("contract") ?? undefined,
              dueWork: params.get("dueWork") ?? undefined,
              dueAccount:
                params.get("dueAccount") === "all"
                  ? "all"
                  : AccountSchema.safeParse(params.get("dueAccount")).data,
              back: params.get("back") ?? undefined,
            }
          : undefined
      }
    />
  );
}

export function HouseWritePage() {
  const { action } = useParams();
  const [params] = useSearchParams();
  const key = `${action}:${params.toString()}`;
  if (action === "payment") return <HousePaymentForm key={key} />;
  if (action === "purchase" || action === "charge")
    return <HouseCostForm key={key} action={action} />;
  return <HouseWriteChooser />;
}
