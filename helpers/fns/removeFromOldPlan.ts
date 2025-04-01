import { ApiKeyInfo } from "../../types/apiKeyInfo";
import {
  APIGatewayClient,
  NotFoundException,
  GetUsagePlanKeyCommand,
  DeleteUsagePlanKeyCommand,
} from "@aws-sdk/client-api-gateway";

export async function removeFromOldPlan(
  apiKeyInfo: ApiKeyInfo,
  apiGatewayClient: APIGatewayClient
) {
  //check if it is attached to old plan
  let isAttachedToOldPlan = false;

  try {
    await apiGatewayClient.send(
      new GetUsagePlanKeyCommand({
        usagePlanId: apiKeyInfo.usagePlanId,
        keyId: apiKeyInfo.apiKeyId,
      })
    );

    isAttachedToOldPlan = true;
  } catch (error: unknown) {
    //if it is not, it throws this error
    if (error instanceof NotFoundException) {
      isAttachedToOldPlan = false;
    } else {
      //throw alll other errorss
      throw error;
    }
  }

  //if it is attached to the old plan, remove it, if not skip
  if (isAttachedToOldPlan) {
    await apiGatewayClient.send(
      new DeleteUsagePlanKeyCommand({
        keyId: apiKeyInfo.apiKeyId,
        usagePlanId: apiKeyInfo.usagePlanId,
      })
    );
  }

  console.log("successfully removed from old plan");
}
