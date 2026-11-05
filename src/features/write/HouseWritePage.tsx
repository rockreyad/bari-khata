import { useParams, useSearchParams } from "react-router";
import { QuickActionsSheet } from "../entries/QuickActionsSheet";
import { HouseCostForm } from "./HouseCostForm";
import { HousePaymentForm } from "./HousePaymentForm";
import "./house-write.css";

export function HouseWriteChooser() {
  return <QuickActionsSheet />;
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
