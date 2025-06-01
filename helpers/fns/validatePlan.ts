import { PaymentPlansResponse } from "../../types/paymentPlans";
import { UsagePlans } from "../schemaValidator/usagePlanValidator";

/**
 * Fetches plans from the payment gateway and validates the specified plan name.
 *
 * @param paymentSecretName - The name of the paymentgatewaySecret as it is stored in secret manager
 * @param usagePlanSecretName - The name of the usage plan secret as it is stored in secret manager
 * @param planName - The name of the plan to validate.
 * @param region - The region where the secrets are stored
 * @returns A promise that resolves to a PaymentPlan or undefined.
 * @throws Error if the request to the payment gateway fails.
 */

export async function validatePlan({
  planName,
  usagePlans,
  paymentPlans,
}: {
  planName: string;
  usagePlans: UsagePlans;
  paymentPlans: PaymentPlansResponse;
}) {
  const trimmedPlanName = planName.toLowerCase().trim();

  //find the plan with th name the customer selected
  const planDetails = paymentPlans.data.find(
    (plan) => trimmedPlanName === plan.name.toLowerCase().trim()
  );

  if (!planDetails || !(trimmedPlanName in usagePlans)) {
    console.log(planDetails, usagePlans);

    throw new Error("Failed to find plan in available plans");
  }

  return {
    planDetails,
    chosenUsagePlanId: usagePlans[planName as keyof typeof usagePlans],
  };
}
