import { APIGatewayProxyEventV2 } from "aws-lambda";
import { planTypeToStatus, PROJECT_STATUS } from "../../helpers/constants";
import { NotFoundException } from "@aws-sdk/client-api-gateway";

global.fetch = jest.fn();

const webHookSecret = "fake-webhook-secret";
const paymentSecret = "fake-payment-secret";

const fakeUserId = "8b7e0e3c-3f4e-4868-8f06-8e8a3f5c51f2";
const fakeProjectId = "e7d9f390-3c4b-4d2c-97a0-bc0fa03e1f8a";
const fakeUsagePlanId = "e3d9f390-3c4b-4d2c-97a0-bc0fa03e1f8a";

const fakeApiKeyInfo = {
  id: "e7d9f390-3c4b-4d2c-97a0-bc0fa03e1f8a",
  value: "e7d9f390-3c4b-4d2c-97a0-bc0fa03e1f8a",
};

const planName = "pro";
const usersEmail = "test@example.com";
const fakeProjectName = "test project";

const eventId = "e7d9f390-3c4b-4d2c-97a0-bc0fa03e1f8a";
const fakeEvent = {
  body: JSON.stringify({
    meta_data: {
      userId: fakeUserId,
      usagePlanId: fakeUsagePlanId,
      projectName: fakeProjectName,
      planName: planName,
      projectId: fakeProjectId,
    },
    event: "charge.completed",
    data: {
      id: eventId,
      status: "successful",
      customer: {
        email: usersEmail,
      },
      created_at: "2025-05-25T12:42:39.000Z",
    },
  }),
  headers: {
    "verif-hash": webHookSecret,
  },
} as unknown as APIGatewayProxyEventV2;

const fakeCardExpiry = "05/25";
const fakeCardToken = "fake-card-token";

console.log = jest.fn();
console.error = jest.fn();

describe("webhook handler", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    process.env.REGION = "us-east-1";
    process.env.TABLE_NAME = "fake-table-name";
    process.env.PAYMENT_SECRET_NAME = "fake-payment-secret-name";
    process.env.WEBHOOK_SECRET_NAME = "fake-webhook-secret-name";
    process.env.PAYMENT_GATEWAY_URL = "fake-payment-gateway-url";
  });

  test("it should create a new project", async () => {
    const mockPutCommand = jest.fn();
    const mockUpdateCommand = jest.fn();
    const mockGetCommand = jest.fn().mockResolvedValue({
      Item: null,
    });

    jest.mock("@aws-sdk/lib-dynamodb", () => {
      return {
        DynamoDBDocumentClient: {
          from: jest.fn().mockImplementation(() => ({
            send: jest.fn().mockImplementation((command) => {
              return command;
            }),
          })),
        },
        PutCommand: mockPutCommand,
        GetCommand: mockGetCommand,
        UpdateCommand: mockUpdateCommand,
      };
    });

    const mockGetSecretValueCommand = jest
      .fn()
      .mockImplementation((commandParams) => {
        if (commandParams.SecretId === process.env.PAYMENT_SECRET_NAME) {
          return {
            SecretString: paymentSecret,
          };
        }

        if (commandParams.SecretId === process.env.WEBHOOK_SECRET_NAME) {
          return {
            SecretString: webHookSecret,
          };
        }

        throw new Error("Secret not found");
      });

    jest.mock("@aws-sdk/client-secrets-manager", () => {
      return {
        SecretsManagerClient: jest.fn().mockImplementation(() => ({
          send: jest.fn().mockImplementation((command) => {
            return command;
          }),
        })),
        GetSecretValueCommand: mockGetSecretValueCommand,
      };
    });

    const mockCreateApiKeyCommand = jest.fn().mockImplementation(() => {
      return fakeApiKeyInfo;
    });

    const mockCreateUsagePlanKeyCommand = jest.fn();

    jest.mock("@aws-sdk/client-api-gateway", () => {
      return {
        APIGatewayClient: jest.fn().mockImplementation(() => ({
          send: jest.fn().mockImplementation((command) => {
            return command;
          }),
        })),
        CreateApiKeyCommand: mockCreateApiKeyCommand,
        CreateUsagePlanKeyCommand: mockCreateUsagePlanKeyCommand,
      };
    });

    const mockedFetch = fetch as jest.MockedFunction<typeof fetch>;

    mockedFetch.mockResolvedValue({
      json: jest.fn().mockResolvedValueOnce({
        data: {
          status: "successful",
          card: {
            expiry: fakeCardExpiry,
            token: fakeCardToken,
          },
        },
      }),
      ok: true,
    } as unknown as Response);

    const { handler } = await import("../../lambda-handlers/webhook-handler");

    const event = fakeEvent;

    const res = await handler(event);

    expect(console.log).toHaveBeenCalledWith(JSON.parse(event.body!));

    expect(console.log).toHaveBeenCalledWith("cold start, so fetching secrets");

    expect(mockGetSecretValueCommand).toHaveBeenCalledTimes(2);
    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.PAYMENT_SECRET_NAME,
    });
    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.WEBHOOK_SECRET_NAME,
    });

    expect(console.log).toHaveBeenCalledWith(
      "verified webhook event data successfully"
    );

    expect(mockedFetch).toHaveBeenCalledWith(expect.any(String), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${paymentSecret}`,
      },
    });

    expect(mockGetCommand).toHaveBeenCalledTimes(1);
    expect(mockGetCommand).toHaveBeenCalledWith({
      TableName: process.env.TABLE_NAME!,
      Key: {
        projectId: fakeProjectId,
        userId: fakeUserId,
      },
      ProjectionExpression: "apiKeyInfo, sub_status",
    });

    expect(mockCreateApiKeyCommand).toHaveBeenCalledTimes(1);
    expect(mockCreateApiKeyCommand).toHaveBeenCalledWith({
      value: expect.any(String),
      name: `${fakeProjectName.replace(" ", "_")}_${fakeUserId}`,
      enabled: true,
    });
    expect(mockCreateUsagePlanKeyCommand).toHaveBeenCalledTimes(1);
    expect(mockCreateUsagePlanKeyCommand).toHaveBeenCalledWith({
      usagePlanId: fakeUsagePlanId,
      keyId: fakeApiKeyInfo.id,
      keyType: "API_KEY",
    });

    expect(mockPutCommand).toHaveBeenCalledTimes(1);
    expect(mockPutCommand).toHaveBeenCalledWith({
      TableName: process.env.TABLE_NAME!,
      Item: {
        email: usersEmail,
        userId: fakeUserId,
        projectId: fakeProjectId,
        apiKeyInfo: {
          apiKeyId: fakeApiKeyInfo.id,
          usagePlanId: fakeUsagePlanId,
        },
        currentPlan: planName,
        projectName: fakeProjectName,
        cardTokenInfo: {
          cardToken: fakeCardToken,
          cardExpiry: fakeCardExpiry,
        },
        apiKey: fakeApiKeyInfo.value,
        nextPaymentDate: expect.any(Number),
        sub_status: planTypeToStatus[planName],
        currentBillingDate: expect.any(Number),
        createdAt: expect.any(Number),
      },
    });

    expect(console.log).toHaveBeenLastCalledWith("completed successfully");

    expect(res).toEqual({
      statusCode: 200,
      body: JSON.stringify({ message: "Api key generated" }),
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Api-Key",
      },
    });
  });

  test("it should update an reactivate the apikey if the project was cancelled previously", async () => {
    const mockUpdateCommand = jest.fn();
    const mockGetCommand = jest.fn().mockResolvedValue({
      Item: {
        apiKeyInfo: {
          apiKeyId: fakeApiKeyInfo.id,
          usagePlanId: fakeUsagePlanId,
        },
        sub_status: PROJECT_STATUS.Inactive,
      },
    });

    jest.mock("@aws-sdk/lib-dynamodb", () => {
      return {
        DynamoDBDocumentClient: {
          from: jest.fn().mockImplementation(() => ({
            send: jest.fn().mockImplementation((command) => {
              return command;
            }),
          })),
        },
        GetCommand: mockGetCommand,
        UpdateCommand: mockUpdateCommand,
      };
    });

    const mockGetSecretValueCommand = jest
      .fn()
      .mockImplementation((commandParams) => {
        if (commandParams.SecretId === process.env.PAYMENT_SECRET_NAME) {
          return {
            SecretString: paymentSecret,
          };
        }

        if (commandParams.SecretId === process.env.WEBHOOK_SECRET_NAME) {
          return {
            SecretString: webHookSecret,
          };
        }

        throw new Error("Secret not found");
      });

    jest.mock("@aws-sdk/client-secrets-manager", () => {
      return {
        SecretsManagerClient: jest.fn().mockImplementation(() => ({
          send: jest.fn().mockImplementation((command) => {
            return command;
          }),
        })),
        GetSecretValueCommand: mockGetSecretValueCommand,
      };
    });

    const mockUpdateApiKeyCommand = jest.fn();
    jest.mock("@aws-sdk/client-api-gateway", () => {
      return {
        APIGatewayClient: jest.fn().mockImplementation(() => ({
          send: jest.fn().mockImplementation((command) => {
            return command;
          }),
        })),
        UpdateApiKeyCommand: mockUpdateApiKeyCommand,
      };
    });

    const mockedFetch = fetch as jest.MockedFunction<typeof fetch>;

    mockedFetch.mockResolvedValue({
      json: jest.fn().mockResolvedValueOnce({
        data: {
          status: "successful",
          card: {
            expiry: fakeCardExpiry,
            token: fakeCardToken,
          },
        },
      }),
      ok: true,
    } as unknown as Response);

    const { handler } = await import("../../lambda-handlers/webhook-handler");

    const event = fakeEvent;

    const res = await handler(event);

    expect(console.log).toHaveBeenCalledWith(JSON.parse(event.body!));

    expect(console.log).toHaveBeenCalledWith("cold start, so fetching secrets");

    expect(mockGetSecretValueCommand).toHaveBeenCalledTimes(2);
    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.PAYMENT_SECRET_NAME,
    });
    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.WEBHOOK_SECRET_NAME,
    });

    expect(console.log).toHaveBeenCalledWith(
      "verified webhook event data successfully"
    );

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(mockedFetch).toHaveBeenCalledWith(
      `${process.env.PAYMENT_GATEWAY_URL}/transactions/${eventId}/verify`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${paymentSecret}`,
        },
      }
    );

    expect(mockGetCommand).toHaveBeenCalledTimes(1);
    expect(mockGetCommand).toHaveBeenCalledWith({
      TableName: process.env.TABLE_NAME!,
      Key: {
        projectId: fakeProjectId,
        userId: fakeUserId,
      },
      ProjectionExpression: "apiKeyInfo, sub_status",
    });

    expect(mockUpdateApiKeyCommand).toHaveBeenCalledTimes(1);
    expect(mockUpdateApiKeyCommand).toHaveBeenCalledWith({
      apiKey: fakeApiKeyInfo.id,
      patchOperations: [{ op: "replace", path: "/enabled", value: "true" }],
    });

    expect(mockUpdateCommand).toHaveBeenCalledTimes(1);
    expect(mockUpdateCommand).toHaveBeenCalledWith({
      TableName: process.env.TABLE_NAME!,
      Key: {
        projectId: fakeProjectId,
        userId: fakeUserId,
      },
      UpdateExpression:
        "set nextPaymentDate = :currentTimestamp, currentBillingDate = :currentBillingDate, apiKeyInfo.usagePlanId = :usagePlanId, currentPlan = :planName, cardTokenInfo.cardToken = :cardToken, cardTokenInfo.cardExpiry = :cardExpiry, sub_status = :sub_status",
      ExpressionAttributeValues: {
        ":sub_status": planTypeToStatus[planName],
        ":planName": planName,
        ":usagePlanId": fakeUsagePlanId,
        ":cardToken": fakeCardToken,
        ":cardExpiry": fakeCardExpiry,
        ":currentBillingDate": expect.any(Number),
        ":currentTimestamp": expect.any(Number),
      },
    });

    expect(console.log).toHaveBeenLastCalledWith("completed successfully");

    expect(res).toEqual({
      statusCode: 200,
      body: JSON.stringify({ message: "Api key generated" }),
    });
  });

  test("it should migrate the apikey to the new usage plan that was paid for", async () => {
    const oldUsagePlanId = "123e4567-e89b-12d3-a456-426614174000"; //old usage plan id

    const mockUpdateCommand = jest.fn();
    const mockGetCommand = jest.fn().mockResolvedValue({
      Item: {
        apiKeyInfo: {
          apiKeyId: fakeApiKeyInfo.id,
          usagePlanId: oldUsagePlanId,
        },
        sub_status: PROJECT_STATUS.ActivePro,
      },
    });

    jest.mock("@aws-sdk/lib-dynamodb", () => {
      return {
        DynamoDBDocumentClient: {
          from: jest.fn().mockImplementation(() => ({
            send: jest.fn().mockImplementation((command) => {
              return command;
            }),
          })),
        },
        GetCommand: mockGetCommand,
        UpdateCommand: mockUpdateCommand,
      };
    });

    const mockGetSecretValueCommand = jest
      .fn()
      .mockImplementation((commandParams) => {
        if (commandParams.SecretId === process.env.PAYMENT_SECRET_NAME) {
          return {
            SecretString: paymentSecret,
          };
        }

        if (commandParams.SecretId === process.env.WEBHOOK_SECRET_NAME) {
          return {
            SecretString: webHookSecret,
          };
        }

        throw new Error("Secret not found");
      });

    jest.mock("@aws-sdk/client-secrets-manager", () => {
      return {
        SecretsManagerClient: jest.fn().mockImplementation(() => ({
          send: jest.fn().mockImplementation((command) => {
            return command;
          }),
        })),
        GetSecretValueCommand: mockGetSecretValueCommand,
      };
    });

    const mockUpdateApiKeyCommand = jest.fn();
    const mockGetUsagePlanKeyCommand = jest
      .fn()
      .mockImplementation((commandParams) => {
        if (commandParams.usagePlanId === oldUsagePlanId) {
          return true;
        }

        throw new NotFoundException({
          message: "Not attached to new plan",
          $metadata: {},
        });
      });
    const mockDeleteUsagePlanKeyCommand = jest.fn();
    const mockCreateUsagePlanKeyCommand = jest.fn();
    jest.mock("@aws-sdk/client-api-gateway", () => {
      return {
        APIGatewayClient: jest.fn().mockImplementation(() => ({
          send: jest.fn().mockImplementation((command) => {
            return command;
          }),
        })),
        UpdateApiKeyCommand: mockUpdateApiKeyCommand,
        GetUsagePlanKeyCommand: mockGetUsagePlanKeyCommand,
        CreateUsagePlanKeyCommand: mockCreateUsagePlanKeyCommand,
        DeleteUsagePlanKeyCommand: mockDeleteUsagePlanKeyCommand,
        NotFoundException: NotFoundException,
      };
    });

    const mockedFetch = fetch as jest.MockedFunction<typeof fetch>;

    mockedFetch.mockResolvedValue({
      json: jest.fn().mockResolvedValueOnce({
        data: {
          status: "successful",
          card: {
            expiry: fakeCardExpiry,
            token: fakeCardToken,
          },
        },
      }),
      ok: true,
    } as unknown as Response);

    const { handler } = await import("../../lambda-handlers/webhook-handler");

    const event = fakeEvent;

    const res = await handler(event);

    expect(console.log).toHaveBeenCalledWith(JSON.parse(event.body!));

    expect(console.log).toHaveBeenCalledWith("cold start, so fetching secrets");

    expect(mockGetSecretValueCommand).toHaveBeenCalledTimes(2);

    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.PAYMENT_SECRET_NAME,
    });

    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.WEBHOOK_SECRET_NAME,
    });

    expect(console.log).toHaveBeenCalledWith(
      "verified webhook event data successfully"
    );

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(mockedFetch).toHaveBeenCalledWith(
      `${process.env.PAYMENT_GATEWAY_URL}/transactions/${eventId}/verify`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${paymentSecret}`,
        },
      }
    );

    expect(mockGetCommand).toHaveBeenCalledTimes(1);
    expect(mockGetCommand).toHaveBeenCalledWith({
      TableName: process.env.TABLE_NAME!,
      Key: {
        projectId: fakeProjectId,
        userId: fakeUserId,
      },
      ProjectionExpression: "apiKeyInfo, sub_status",
    });

    expect(mockGetUsagePlanKeyCommand).toHaveBeenCalledTimes(2);

    expect(mockGetUsagePlanKeyCommand).toHaveBeenCalledWith({
      keyId: fakeApiKeyInfo.id,
      usagePlanId: oldUsagePlanId,
    });

    expect(mockDeleteUsagePlanKeyCommand).toHaveBeenCalledTimes(1);
    expect(mockDeleteUsagePlanKeyCommand).toHaveBeenCalledWith({
      keyId: fakeApiKeyInfo.id,
      usagePlanId: oldUsagePlanId,
    });

    expect(mockGetUsagePlanKeyCommand).toHaveBeenLastCalledWith({
      keyId: fakeApiKeyInfo.id,
      usagePlanId: fakeUsagePlanId,
    });

    expect(mockCreateUsagePlanKeyCommand).toHaveBeenCalledTimes(1);
    expect(mockCreateUsagePlanKeyCommand).toHaveBeenCalledWith({
      keyType: "API_KEY",
      usagePlanId: fakeUsagePlanId,
      keyId: fakeApiKeyInfo.id,
    });

    expect(mockUpdateCommand).toHaveBeenCalledTimes(1);
    expect(mockUpdateCommand).toHaveBeenCalledWith({
      TableName: process.env.TABLE_NAME!,
      Key: {
        projectId: fakeProjectId,
        userId: fakeUserId,
      },
      UpdateExpression:
        "set nextPaymentDate = :currentTimestamp, currentBillingDate = :currentBillingDate, apiKeyInfo.usagePlanId = :usagePlanId, currentPlan = :planName, cardTokenInfo.cardToken = :cardToken, cardTokenInfo.cardExpiry = :cardExpiry, sub_status = :sub_status",
      ExpressionAttributeValues: {
        ":sub_status": planTypeToStatus[planName],
        ":planName": planName,
        ":usagePlanId": fakeUsagePlanId,
        ":cardToken": fakeCardToken,
        ":cardExpiry": fakeCardExpiry,
        ":currentBillingDate": expect.any(Number),
        ":currentTimestamp": expect.any(Number),
      },
    });

    expect(console.log).toHaveBeenLastCalledWith("completed successfully");

    expect(res).toEqual({
      statusCode: 200,
      body: JSON.stringify({ message: "Api key generated" }),
    });
  });

  test("it should return a 400 error due to an empty body", async () => {
    const event = { body: null } as unknown as APIGatewayProxyEventV2;

    const { handler } = await import("../../lambda-handlers/webhook-handler");

    const res = await handler(event);

    expect(res).toEqual({
      statusCode: 400,
      body: JSON.stringify({
        message: "Bad Request - No body",
      }),
    });
  });

  test("it should throw an error due to an empty payment or webhook secret", async () => {
    const mockGetSecretValueCommand = jest
      .fn()
      .mockImplementation((commandParams) => {
        if (commandParams.SecretId === process.env.PAYMENT_SECRET_NAME) {
          return {
            SecretString: null,
          };
        }

        if (commandParams.SecretId === process.env.WEBHOOK_SECRET_NAME) {
          return {
            SecretString: webHookSecret,
          };
        }

        throw new Error("Secret not found");
      });

    jest.mock("@aws-sdk/client-secrets-manager", () => {
      return {
        SecretsManagerClient: jest.fn().mockImplementation(() => ({
          send: jest.fn().mockImplementation((command) => {
            return command;
          }),
        })),
        GetSecretValueCommand: mockGetSecretValueCommand,
      };
    });

    const { handler } = await import("../../lambda-handlers/webhook-handler");

    const fakeProjectName = "test project";

    const usersEmail = "test@example.com";

    const event = {
      body: JSON.stringify({
        meta_data: {
          userId: fakeUserId,
          usagePlanId: fakeUsagePlanId,
          projectName: fakeProjectName,
          planName: planName,
          projectId: fakeProjectId,
        },
        event: "charge.completed",
        data: {
          id: "e7d9f390-3c4b-4d2c-97a0-bc0fa03e1f8a",
          status: "successful",
          customer: {
            email: usersEmail,
          },
          created_at: "2025-05-25T12:42:39.000Z",
        },
      }),
      headers: {
        "verif-hash": webHookSecret,
      },
    } as unknown as APIGatewayProxyEventV2;

    await expect(handler(event)).rejects.toThrow(Error);

    expect(console.log).toHaveBeenCalledWith(JSON.parse(event.body!));

    expect(console.log).toHaveBeenCalledWith("cold start, so fetching secrets");

    expect(console.error).toHaveBeenCalledWith(
      "Payment or Webhook secret is empty"
    );

    expect(console.error).toHaveBeenLastCalledWith(
      "ERROR HANDLING WEBHOOK",
      expect.any(Error)
    );

    expect(mockGetSecretValueCommand).toHaveBeenCalledTimes(2);
    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.PAYMENT_SECRET_NAME,
    });
    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.WEBHOOK_SECRET_NAME,
    });
  });

  test("it should throw an error due to an webhook secret mismatch", async () => {
    const mockGetSecretValueCommand = jest
      .fn()
      .mockImplementation((commandParams) => {
        if (commandParams.SecretId === process.env.PAYMENT_SECRET_NAME) {
          return {
            SecretString: paymentSecret,
          };
        }

        if (commandParams.SecretId === process.env.WEBHOOK_SECRET_NAME) {
          return {
            SecretString: "invalid secret",
          };
        }

        throw new Error("Secret not found");
      });

    jest.mock("@aws-sdk/client-secrets-manager", () => {
      return {
        SecretsManagerClient: jest.fn().mockImplementation(() => ({
          send: jest.fn().mockImplementation((command) => {
            return command;
          }),
        })),
        GetSecretValueCommand: mockGetSecretValueCommand,
      };
    });

    const { handler } = await import("../../lambda-handlers/webhook-handler");

    const fakeProjectName = "test project";

    const usersEmail = "test@example.com";

    const event = {
      body: JSON.stringify({
        meta_data: {
          userId: fakeUserId,
          usagePlanId: fakeUsagePlanId,
          projectName: fakeProjectName,
          planName: planName,
          projectId: fakeProjectId,
        },
        event: "charge.completed",
        data: {
          id: "e7d9f390-3c4b-4d2c-97a0-bc0fa03e1f8a",
          status: "successful",
          customer: {
            email: usersEmail,
          },
          created_at: "2025-05-25T12:42:39.000Z",
        },
      }),
      headers: {
        "verif-hash": webHookSecret,
      },
    } as unknown as APIGatewayProxyEventV2;

    await expect(handler(event)).rejects.toThrow(Error);

    expect(console.log).toHaveBeenCalledWith(JSON.parse(event.body!));

    expect(console.log).toHaveBeenCalledWith("cold start, so fetching secrets");

    expect(console.error).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith("Signature does not match");

    expect(console.error).toHaveBeenLastCalledWith(
      "ERROR HANDLING WEBHOOK",
      expect.any(Error)
    );

    expect(mockGetSecretValueCommand).toHaveBeenCalledTimes(2);
    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.PAYMENT_SECRET_NAME,
    });
    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.WEBHOOK_SECRET_NAME,
    });
  });

  test("it should throw an error due to invalid event body schema", async () => {
    const mockGetSecretValueCommand = jest
      .fn()
      .mockImplementation((commandParams) => {
        if (commandParams.SecretId === process.env.PAYMENT_SECRET_NAME) {
          return {
            SecretString: paymentSecret,
          };
        }

        if (commandParams.SecretId === process.env.WEBHOOK_SECRET_NAME) {
          return {
            SecretString: webHookSecret,
          };
        }

        throw new Error("Secret not found");
      });

    jest.mock("@aws-sdk/client-secrets-manager", () => {
      return {
        SecretsManagerClient: jest.fn().mockImplementation(() => ({
          send: jest.fn().mockImplementation((command) => {
            return command;
          }),
        })),
        GetSecretValueCommand: mockGetSecretValueCommand,
      };
    });

    const { handler } = await import("../../lambda-handlers/webhook-handler");

    const usersEmail = "test@example.com";

    const event = {
      body: JSON.stringify({
        event: "charge.completed",
        data: {
          id: "e7d9f390-3c4b-4d2c-97a0-bc0fa03e1f8a",
          status: "successful",
          customer: {
            email: usersEmail,
          },
          created_at: "2025-05-25T12:42:39.000Z",
        },
      }),
      headers: {
        "verif-hash": webHookSecret,
      },
    } as unknown as APIGatewayProxyEventV2;

    await expect(handler(event)).rejects.toThrow(Error);

    expect(mockGetSecretValueCommand).toHaveBeenCalledTimes(2);
    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.PAYMENT_SECRET_NAME,
    });
    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.WEBHOOK_SECRET_NAME,
    });

    expect(console.log).toHaveBeenCalledWith(JSON.parse(event.body!));

    expect(console.log).toHaveBeenCalledWith("cold start, so fetching secrets");

    expect(console.error).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith(
      expect.any(Object),
      "WEBHOOK EVENT SCHEMA VALIDATION FAILED"
    );

    expect(console.error).toHaveBeenLastCalledWith(
      "ERROR HANDLING WEBHOOK",
      expect.any(Error)
    );
  });

  test("it should throw an error due to failed transaction verification request", async () => {
    const mockGetSecretValueCommand = jest
      .fn()
      .mockImplementation((commandParams) => {
        if (commandParams.SecretId === process.env.PAYMENT_SECRET_NAME) {
          return {
            SecretString: paymentSecret,
          };
        }

        if (commandParams.SecretId === process.env.WEBHOOK_SECRET_NAME) {
          return {
            SecretString: webHookSecret,
          };
        }

        throw new Error("Secret not found");
      });

    jest.mock("@aws-sdk/client-secrets-manager", () => {
      return {
        SecretsManagerClient: jest.fn().mockImplementation(() => ({
          send: jest.fn().mockImplementation((command) => {
            return command;
          }),
        })),
        GetSecretValueCommand: mockGetSecretValueCommand,
      };
    });

    const { handler } = await import("../../lambda-handlers/webhook-handler");

    const event = fakeEvent;

    const mockedFetch = fetch as jest.MockedFunction<typeof fetch>;

    mockedFetch.mockResolvedValue({
      json: jest.fn().mockResolvedValueOnce({
        data: {
          status: "failed",
          card: {
            expiry: fakeCardExpiry,
            token: fakeCardToken,
          },
        },
      }),
      ok: false,
    } as unknown as Response);

    await expect(handler(event)).rejects.toThrow(Error);

    expect(mockGetSecretValueCommand).toHaveBeenCalledTimes(2);
    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.PAYMENT_SECRET_NAME,
    });
    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.WEBHOOK_SECRET_NAME,
    });

    expect(console.log).toHaveBeenCalledWith(JSON.parse(event.body!));

    expect(console.log).toHaveBeenCalledWith("cold start, so fetching secrets");

    expect(console.error).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith(
      `Failed to verify charge for ${usersEmail}, PROJECT: ${fakeProjectName}, USER: ${fakeUserId}`,
      expect.any(Object)
    );

    expect(console.error).toHaveBeenLastCalledWith(
      "ERROR HANDLING WEBHOOK",
      expect.any(Error)
    );
  });

  test("it should return a 400 error due to failed payment status from payment gateway", async () => {
    const mockGetSecretValueCommand = jest
      .fn()
      .mockImplementation((commandParams) => {
        if (commandParams.SecretId === process.env.PAYMENT_SECRET_NAME) {
          return {
            SecretString: paymentSecret,
          };
        }

        if (commandParams.SecretId === process.env.WEBHOOK_SECRET_NAME) {
          return {
            SecretString: webHookSecret,
          };
        }

        throw new Error("Secret not found");
      });

    jest.mock("@aws-sdk/client-secrets-manager", () => {
      return {
        SecretsManagerClient: jest.fn().mockImplementation(() => ({
          send: jest.fn().mockImplementation((command) => {
            return command;
          }),
        })),
        GetSecretValueCommand: mockGetSecretValueCommand,
      };
    });

    const { handler } = await import("../../lambda-handlers/webhook-handler");

    const event = fakeEvent;

    const mockedFetch = fetch as jest.MockedFunction<typeof fetch>;

    mockedFetch.mockResolvedValue({
      json: jest.fn().mockResolvedValueOnce({
        data: {
          status: "failed",
          card: {
            expiry: fakeCardExpiry,
            token: fakeCardToken,
          },
        },
      }),
      ok: true,
    } as unknown as Response);

    const res = await handler(event);

    expect(res).toEqual({
      statusCode: 400,
      body: JSON.stringify({
        message: "Payment not successful",
      }),
    });

    expect(mockGetSecretValueCommand).toHaveBeenCalledTimes(2);
    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.PAYMENT_SECRET_NAME,
    });
    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.WEBHOOK_SECRET_NAME,
    });

    expect(console.log).toHaveBeenCalledWith(JSON.parse(event.body!));

    expect(console.log).toHaveBeenCalledWith("cold start, so fetching secrets");

    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith("Payment not successful");
  });
});
