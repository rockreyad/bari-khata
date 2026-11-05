import { useLocation, useNavigationType } from "react-router";
import { useComposedInput } from "./useComposedInput";

export function useComposedSearch(
  query: string,
  onCommit: (value: string) => void,
) {
  const location = useLocation();
  const navigationType = useNavigationType();
  return useComposedInput(query, onCommit, {
    scope: location.key,
    restore: navigationType === "POP",
  });
}
