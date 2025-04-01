import {
  APIGatewayClient,
  UpdateApiKeyCommand,
} from "@aws-sdk/client-api-gateway";
import { ApiKeyInfo } from "../../types/apiKeyInfo";

export async function updateApiKey(
  apiGatewayClient: APIGatewayClient,
  apiKeyInfo: ApiKeyInfo,
  value: "true" | "false"
) {
  await apiGatewayClient.send(
    new UpdateApiKeyCommand({
      apiKey: apiKeyInfo.apiKeyId,
      patchOperations: [
        {
          op: "replace",
          path: "/enabled",
          value: value,
        },
      ],
    })
  );
}
