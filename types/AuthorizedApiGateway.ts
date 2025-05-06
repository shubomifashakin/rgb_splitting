import {
  APIGatewayProxyEventV2,
  APIGatewayEventRequestContextV2,
} from "aws-lambda";

export interface AuthorizedApiGatewayEvent extends APIGatewayProxyEventV2 {
  requestContext: APIGatewayEventRequestContextV2 & {
    authorizer?: {
      principalId?: string;
    };
  };
}
