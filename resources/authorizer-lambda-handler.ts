import { Callback, Handler } from "aws-lambda";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
  GetSecretValueCommandOutput,
} from "@aws-sdk/client-secrets-manager";

import * as jwt from "jsonwebtoken";

interface JWTClaims extends jwt.JwtPayload {
  metadata: {
    role: string;
  };
}

const secret_name = process.env.CLERK_JWT_SECRET_NAME!;

const secretClient = new SecretsManagerClient({
  region: "us-east-1",
});

let publicKey: GetSecretValueCommandOutput | undefined;

export const handler: Handler = async (
  event: any,
  context,
  callback: Callback
) => {
  const authToken = event.authorizationToken;

  if (!authToken) {
    console.error("NO AUTHORIZATION TOKEN PROVIDED");

    return {
      statusCode: 400,
      body: JSON.stringify({
        message: "Authorization Token Not Provided",
        status: "fail",
      }),
    };
  }

  const token = authToken.split(" ")[1];

  if (typeof token !== "string") {
    return { statusCode: 400, body: "Bad Request - Invalid Token" };
  }

  try {
    if (!publicKey) {
      console.log("cold start, fetching secret from secret manager");

      publicKey = await secretClient.send(
        new GetSecretValueCommand({ SecretId: secret_name })
      );
    }

    if (!publicKey.SecretString) {
      console.log("Public key does not exist");

      return { statusCode: 500, body: JSON.stringify("Internal Server Error") };
    }

    // Verifies and decodes the JWT
    const claims = jwt.verify(token, publicKey.SecretString as string, {
      algorithms: ["RS256"],
    }) as JWTClaims;

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
  } catch (error: unknown) {
    console.log(error);

    return { statusCode: 500, body: JSON.stringify("Internal Server Error") };
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

  console.log("completed successfully");

  return authResponseWithContext;
}
