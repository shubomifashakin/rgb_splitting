import {
  APIGatewayClient,
  CreateUsagePlanKeyCommand,
  GetUsagePlanKeyCommand,
  NotFoundException,
} from "@aws-sdk/client-api-gateway";

import { PROJECT_STATUS } from "../constants";
import { removeFromOldPlan } from "./removeFromOldPlan";
import { updateApiKeyStatus } from "./updateApiKeyStatus";

import { ApiKeyInfo } from "../../types/apiKeyInfo";

/** what this does is this
 
 if the usage plan the apikey is attached to is different from the one paid for,
detach it from the current usage plan its attached to &
attach it to the new usage plan that was paid for

then
if the api was for a project tht was cancelled enable the apikey again
**/
export async function migrateExistingProjectApiKey({
  apiKeyInfo,
  projectStatus,
  newUsagePlanId,
  apiGatewayClient,
}: {
  newUsagePlanId: string;
  apiKeyInfo: ApiKeyInfo;
  projectStatus: PROJECT_STATUS;
  apiGatewayClient: APIGatewayClient;
}) {
  //if it is not the same as the new usage plan -- user changed their plan
  if (apiKeyInfo.usagePlanId !== newUsagePlanId) {
    //remove apiKeyFrom from old plan
    await removeFromOldPlan(apiKeyInfo, apiGatewayClient);

    //check if already attached to new usage plan
    let isAttachedToNewPlan = false;

    try {
      await apiGatewayClient.send(
        new GetUsagePlanKeyCommand({
          keyId: apiKeyInfo.apiKeyId,
          usagePlanId: newUsagePlanId,
        })
      );

      isAttachedToNewPlan = true;
    } catch (error) {
      if (error instanceof NotFoundException) {
        isAttachedToNewPlan = false;
      } else {
        throw error;
      }
    }

    if (!isAttachedToNewPlan) {
      await apiGatewayClient.send(
        new CreateUsagePlanKeyCommand({
          keyType: "API_KEY",
          usagePlanId: newUsagePlanId,
          keyId: apiKeyInfo.apiKeyId,
        })
      );
    }
  }

  if (projectStatus === PROJECT_STATUS.Inactive) {
    await updateApiKeyStatus(apiGatewayClient, apiKeyInfo, "true");
  }
}
