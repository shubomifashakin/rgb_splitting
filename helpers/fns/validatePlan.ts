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
  paymentGatewayUrl,
  paymentGatewaySecret,
}: {
  planName: string;
  paymentGatewayUrl: string;
  usagePlans: UsagePlans;
  paymentGatewaySecret: string;
}) {
  const trimmedPlanName = planName.toLowerCase().trim();

  const url = `${paymentGatewayUrl}/payment-plans?status=active`;

  const getAllPlansOnPaymentGatewayReq = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${paymentGatewaySecret}`,
      "Content-Type": "application/json",
      accept: "application/json",
    },
  });

  if (!getAllPlansOnPaymentGatewayReq.ok) {
    const res = await getAllPlansOnPaymentGatewayReq.json();

    throw new Error(
      `failed to get plans from payment gateway: ${JSON.stringify(res)}`
    );
  }

  const allPlansInPaymentGateway =
    (await getAllPlansOnPaymentGatewayReq.json()) as PaymentPlansResponse;

  //find the plan with th name the customer selected
  const planDetails = allPlansInPaymentGateway.data.find(
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
