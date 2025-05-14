import { Context } from "aws-lambda";
import { handler } from "../../resources/authorizer-lambda-handler";

import * as jwt from "jsonwebtoken";

jest.mock("@aws-sdk/client-secrets-manager", () => {
  return {
    SecretsManagerClient: jest.fn().mockImplementation(() => ({
      send: jest.fn().mockResolvedValue({
        SecretString: "fake-public-key",
      }),
    })),
    GetSecretValueCommand: jest.fn(),
    GetSecretValueCommandOutput: jest.fn(),
  };
});

describe("authorizer lambda handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("it allow access to the arn", async () => {
    const event = {
      authorizationToken: "Bearer fake-token",
      methodArn: "fake-method-arn",
    };

    jest.spyOn(jwt, "verify").mockImplementation(() => {
      return { sub: "fake-sub" };
    });

    const context = {};

    const callback = jest.fn();

    await handler(event, context as Context, callback);

    expect(jwt.verify).toHaveBeenCalledTimes(1);
    expect(jwt.verify).toHaveBeenCalledWith("fake-token", "fake-public-key", {
      algorithms: ["RS256"],
    });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(null, {
      principalId: "fake-sub",
      policyDocument: {
        Version: "2012-10-17",
        Statement: [
          {
            Action: "execute-api:Invoke",
            Effect: "Allow",
            Resource: "fake-method-arn",
          },
        ],
      },
    });
  });

  test("it should deny access to the arn", async () => {
    const event = {
      authorizationToken: "Bearer fake-token",
      methodArn: "fake-method-arn",
    };

    jest.spyOn(jwt, "verify").mockImplementation(() => {
      return { sub: "" };
    });

    const context = {};

    const callback = jest.fn();

    await handler(event, context as Context, callback);

    expect(jwt.verify).toHaveBeenCalledTimes(1);
    expect(jwt.verify).toHaveBeenCalledWith("fake-token", "fake-public-key", {
      algorithms: ["RS256"],
    });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(null, {
      principalId: "",
      policyDocument: {
        Version: "2012-10-17",
        Statement: [
          {
            Action: "execute-api:Invoke",
            Effect: "Deny",
            Resource: "fake-method-arn",
          },
        ],
      },
    });
  });

  test("it should return a 400 error", async () => {
    const event = {
      authorizationToken: "",
      methodArn: "fake-method-arn",
    };

    const context = {};

    const callback = jest.fn();

    const res = await handler(event, context as Context, callback);

    console.log(res);

    expect(res).toEqual({
      statusCode: 400,
      body: JSON.stringify({
        message: "Authorization Token Not Provided",
        status: "fail",
      }),
    });
  });

  test("it should return a 500 error", async () => {
    const event = {
      authorizationToken: "Bearer fake-token",
      methodArn: "fake-method-arn",
    };

    jest.spyOn(jwt, "verify").mockImplementation(() => {
      throw new Error("Invalid Token");
    });

    const context = {};

    const callback = jest.fn();

    const res = await handler(event, context as Context, callback);

    expect(res).toEqual({
      statusCode: 500,
      body: JSON.stringify("Internal Server Error"),
    });
  });
});
