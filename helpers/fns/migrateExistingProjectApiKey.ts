import {
  APIGatewayClient,
  CreateUsagePlanKeyCommand,
  GetUsagePlanKeyCommand,
  NotFoundException,
} from "@aws-sdk/client-api-gateway";
import { PROJECT_STATUS } from "../constants";
import { updateApiKey } from "./updateApiKey";
import { removeFromOldPlan } from "./removeFromOldPlan";
import { ApiKeyInfo } from "../../types/apiKeyInfo";

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
          usagePlanId: newUsagePlanId,
          keyId: apiKeyInfo.apiKeyId,
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
    await updateApiKey(apiGatewayClient, apiKeyInfo, "true");
  }
}
