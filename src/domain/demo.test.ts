import { expect, it } from "vitest";
import { createDemoLedger } from "./demo";
import {
  canRecordContactCost,
  contactEntryPolicy,
  getContactEntryDefaults,
} from "./contactEntryPolicy";

it("seeds explicit sample contact rules and clear sector associations for new demo notebooks", () => {
  const demo = createDemoLedger();
  expect(demo.isDemo).toBe(true);
  for (const person of demo.people) {
    expect(person.contactType).toBeTruthy();
    expect(person.roles).toHaveLength(1);
    expect(person.workIds).toHaveLength(1);
  }
  const worker = demo.people.find((person) => person.id === "electric-worker")!;
  const shop = demo.people.find((person) => person.id === "shop")!;
  const driver = demo.people.find((person) => person.id === "driver")!;
  expect(contactEntryPolicy(worker)).toMatchObject({
    purchase: false,
    reimbursement: true,
    agreement: true,
    defaultAccount: "labour",
  });
  expect(
    canRecordContactCost(worker, {
      account: "materials",
      costType: "material",
    }),
  ).toBe(false);
  expect(
    canRecordContactCost(worker, {
      account: "materials",
      costType: "material",
      reimbursement: true,
    }),
  ).toBe(true);
  expect(contactEntryPolicy(shop)).toMatchObject({
    purchase: true,
    agreement: false,
    chargeCostTypes: [],
  });
  expect(contactEntryPolicy(driver)).toMatchObject({
    purchase: false,
    agreement: false,
    chargeCostTypes: ["transport"],
    defaultAccount: "other",
  });
  expect(getContactEntryDefaults(demo, worker).workId).toBe("electric");
  expect(getContactEntryDefaults(demo, shop).workId).toBe("tiles");
});
