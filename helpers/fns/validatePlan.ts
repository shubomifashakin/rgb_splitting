import { SecretsManager } from "aws-sdk";
import { PaymentPlan, PaymentPlansResponse } from "../../types/paymentPlans";
import { usagePlanValidator } from "../schemaValidator/validators";

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
  paymentGatewaySecretName,
  usagePlanSecretName,
  planName,
  region,
  paymentGatewayUrl,
}: {
  paymentGatewaySecretName: string;
  usagePlanSecretName: string;
  planName: string;
  region: string;
  paymentGatewayUrl: string;
}): Promise<{
  planDetails: PaymentPlan;
  chosenUsagePlan: string;
  paymentGatewaySecret: string;
}> {
  const secretClient = new SecretsManager({
    region,
  });

  const trimmedPlanName = planName.toLowerCase().trim();

  //fetch the payment gateway secret and the available usage plans secret
  const [paymentGatewaySecret, availableUsagePlans] = await Promise.all([
    secretClient
      .getSecretValue({ SecretId: paymentGatewaySecretName })
      .promise(),
    secretClient.getSecretValue({ SecretId: usagePlanSecretName }).promise(),
  ]);

  if (!paymentGatewaySecret.SecretString || !availableUsagePlans.SecretString) {
    throw new Error(
      "Payment gateway secret or available usage plans secret not found"
    );
  }

  const trimmedAvailablePlans = JSON.parse(availableUsagePlans.SecretString!);

  //validate the usage plans received
  const {
    success,
    error,
    data: allUsagePlans,
  } = usagePlanValidator.safeParse(trimmedAvailablePlans);

  if (!success) {
    throw new Error(error.message);
  }

  const url = `${paymentGatewayUrl}/payment-plans?status=active`;

  const getAllPlansOnPaymentGatewayReq = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${paymentGatewaySecret.SecretString}`,
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

  if (!planDetails || !(trimmedPlanName in allUsagePlans)) {
    console.log(planDetails, allUsagePlans);

    throw new Error("Failed to find plan in available plans");
  }

  return {
    planDetails,
    paymentGatewaySecret: paymentGatewaySecret.SecretString,
    chosenUsagePlan: allUsagePlans[planName as keyof typeof allUsagePlans],
  };
}
