import {
  APIGatewayRequestAuthorizerEventV2,
  Callback,
  Handler,
} from "aws-lambda";

import * as jwt from "jsonwebtoken";

const publicKey = process.env.CLERK_JWT;

interface JWTClaims extends jwt.JwtPayload {
  metadata: {
    role: string;
  };
}

export const handler: Handler = async (
  event: any,
  context,
  callback: Callback
) => {
  // Extract the token from the Authorization header
  const token = event.authorizationToken.split(" ")[1];

  console.log(token);
  console.log(event.methodArn);

  if (!token) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        message: "Authorization Token Not Provided",
        status: "fail",
      }),
    };
  }

  if (!publicKey) {
    return { statusCode: 500, body: JSON.stringify("Internal Server Error") };
  }

  // Verifies and decodes the JWT
  const claims = jwt.verify(token, publicKey, {
    algorithms: ["RS256"],
  }) as JWTClaims;

  // Check if the user is an admin
  // if (claims.metadata.role) { TODO: THIS IS THE RIGHT ONE
  if (claims.sub) {
    return callback(
      null,
      //TODO: PASS METADATA AS FIRST VALUE
      generatePolicy(null, claims.sub, "Allow", event.methodArn)
    );
  } else {
    return callback(
      null,
      generatePolicy(null, claims.sub, "Deny", event.methodArn)
    );
  }
};

function generatePolicy(
  metadata: JWTClaims["metadata"] | null,
  principalId: string | undefined,
  effect: string,
  resource: string
) {
  const authResponse = {
    principalId: principalId,
    policyDocument: {
      Version: "2012-10-17",
      Statement: [
        {
          Action: "execute-api:Invoke",
          Effect: effect,
          Resource: resource,
        },
      ],
    },
  };

  const authResponseWithContext = {
    ...authResponse,
    ...(metadata && { context: metadata }),
  };

  return authResponseWithContext;
}
