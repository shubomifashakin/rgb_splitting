import { Context } from "aws-lambda";

console.log = jest.fn();
console.error = jest.fn();

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
    jest.resetModules();
  });

  test("it allows access to the arn", async () => {
    const event = {
      authorizationToken: "Bearer fake-token",
      methodArn: "fake-method-arn",
    };

    const mockVerifyJwt = jest.fn().mockImplementation(() => {
      return { sub: "fake-sub" };
    });

    jest.mock("jsonwebtoken", () => {
      return { verify: mockVerifyJwt };
    });

    const context = {};

    const callback = jest.fn();

    const { handler } = await import(
      "../../resources/authorizer-lambda-handler"
    );

    await handler(event, context as Context, callback);

    expect(mockVerifyJwt).toHaveBeenCalledTimes(1);
    expect(mockVerifyJwt).toHaveBeenCalledWith(
      "fake-token",
      "fake-public-key",
      {
        algorithms: ["RS256"],
      }
    );

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

  test("it should deny access to the arn due to missing jwt claims", async () => {
    const event = {
      authorizationToken: "Bearer fake-token",
      methodArn: "fake-method-arn",
    };

    const mockVerifyJwt = jest.fn().mockImplementation(() => {
      return { sub: "" };
    });

    jest.mock("jsonwebtoken", () => {
      return { verify: mockVerifyJwt };
    });

    const context = {};

    const callback = jest.fn();

    const { handler } = await import(
      "../../resources/authorizer-lambda-handler"
    );

    await handler(event, context as Context, callback);

    expect(mockVerifyJwt).toHaveBeenCalledTimes(1);
    expect(mockVerifyJwt).toHaveBeenCalledWith(
      "fake-token",
      "fake-public-key",
      {
        algorithms: ["RS256"],
      }
    );

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

  test("it should deny access to the arn due to missing secret", async () => {
    const event = {
      authorizationToken: "Bearer fake-token",
      methodArn: "fake-method-arn",
    };

    jest.mock("@aws-sdk/client-secrets-manager", () => {
      return {
        SecretsManagerClient: jest.fn().mockImplementation(() => ({
          send: jest.fn().mockResolvedValue({
            SecretString: null,
          }),
        })),
        GetSecretValueCommand: jest.fn(),
        GetSecretValueCommandOutput: jest.fn(),
      };
    });

    const context = {};

    const callback = jest.fn();

    const { handler } = await import(
      "../../resources/authorizer-lambda-handler"
    );

    const res = await handler(event, context as Context, callback);

    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith("Public key does not exist");

    expect(res).toEqual({
      statusCode: 500,
      body: JSON.stringify("Internal Server Error"),
    });
  });

  test("it should return a 401 error due to missing authorization token", async () => {
    const event = {
      authorizationToken: "",
      methodArn: "fake-method-arn",
    };

    const context = {};

    const callback = jest.fn();

    const { handler } = await import(
      "../../resources/authorizer-lambda-handler"
    );

    const res = await handler(event, context as Context, callback);

    expect(console.log).toHaveBeenCalledTimes(2);
    expect(console.log).toHaveBeenCalledWith(event);
    expect(console.log).toHaveBeenLastCalledWith(
      "NO AUTHORIZATION TOKEN PROVIDED"
    );

    expect(res).toEqual({
      statusCode: 401,
      body: JSON.stringify({
        message: "Unauthorized",
        status: "fail",
      }),
    });
  });

  test("it should return a 500 error", async () => {
    const event = {
      authorizationToken: "Bearer fake-token",
      methodArn: "fake-method-arn",
    };

    jest.mock("@aws-sdk/client-secrets-manager", () => {
      return {
        SecretsManagerClient: jest.fn().mockImplementation(() => ({
          send: jest.fn().mockResolvedValue({
            SecretString: "null",
          }),
        })),
        GetSecretValueCommand: jest.fn(),
        GetSecretValueCommandOutput: jest.fn(),
      };
    });

    const mockVerifyJwt = jest.fn().mockImplementation(() => {
      throw new Error("Invalid Token");
    });

    jest.mock("jsonwebtoken", () => {
      return { verify: mockVerifyJwt };
    });

    const context = {};

    const callback = jest.fn();

    const { handler } = await import(
      "../../resources/authorizer-lambda-handler"
    );

    const res = await handler(event, context as Context, callback);

    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(expect.any(Error));

    expect(res).toEqual({
      statusCode: 500,
      body: JSON.stringify("Internal Server Error"),
    });
  });
});
