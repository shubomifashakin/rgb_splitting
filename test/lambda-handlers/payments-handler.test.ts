import { APIGatewayProxyEventV2 } from "aws-lambda";
import {
  maxActiveFreeProjects,
  PlanType,
  planTypeToStatus,
} from "../../helpers/constants";
import { getOneMonthFromDate } from "../../helpers/fns/oneMonthFromDate";
import { NotFoundException } from "@aws-sdk/client-api-gateway";

const proPrice = 1000;
const executivePrice = 2000;
const fullName = "John Stiffman";
const email = "test@email.com";
const userId = "123e4567-e89b-12d3-a456-426614174000";
const projectName = "test-project";

const projectId = "123e4567-e89b-12d3-a456-426614174000";

const paymentSecret = "test-payment-secret";

const proUsagePlanId = "pro-id";
const freeUsagePlanId = "free-id";
const executiveUsagePlanId = "executive-id";

const usagePlansSecret = JSON.stringify({
  pro: proUsagePlanId,
  free: freeUsagePlanId,
  executive: executiveUsagePlanId,
});

console.log = jest.fn();
console.error = jest.fn();

const mockUUid = "123e4567-e89b-12d3-a456-426614174000";

describe("payments-handler test", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    process.env.REGION = "eu-west-2";
    process.env.TABLE_NAME = "test-table";
    process.env.PAYMENT_GATEWAY_URL = "http://localhost:3000";
    process.env.PAYMENT_SECRET_NAME = "test-payment-secret";
    process.env.AVAILABLE_PLANS_SECRET_NAME = "test-available-plans-secret";

    jest.mock("uuid", () => ({
      v4: jest.fn().mockReturnValue(mockUUid),
    }));
  });

  test("it should trigger payment", async () => {
    const mockGetSecretValueCommand = jest
      .fn()
      .mockImplementation((commandParams) => {
        if (commandParams.SecretId === process.env.PAYMENT_SECRET_NAME) {
          return {
            SecretString: paymentSecret,
          };
        }

        if (
          commandParams.SecretId === process.env.AVAILABLE_PLANS_SECRET_NAME
        ) {
          return {
            SecretString: usagePlansSecret,
          };
        }

        throw new Error("Secret not found");
      });

    jest.mock("@aws-sdk/client-secrets-manager", () => ({
      SecretsManagerClient: jest.fn().mockImplementation(() => ({
        send: jest.fn().mockImplementation((command) => {
          return command;
        }),
      })),
      GetSecretValueCommand: mockGetSecretValueCommand,
    }));

    global.fetch = jest.fn().mockImplementation((input) => {
      if (
        input ===
        `${process.env.PAYMENT_GATEWAY_URL}/payment-plans?status=active`
      ) {
        return {
          ok: true,
          json: jest.fn().mockResolvedValue({
            data: [
              {
                id: "1",
                name: "Pro",
                amount: proPrice,
                currency: "NGN",
              },
              {
                id: "2",
                name: "Executive",
                amount: executivePrice,
                currency: "NGN",
              },
            ],
          }),
        };
      }

      return {
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: "created charge",
        }),
      };
    });

    const event = {
      body: JSON.stringify({
        planName: PlanType.Pro,
        projectName,
        email,
        userId,
        fullName,
      }),
    } as unknown as APIGatewayProxyEventV2;

    const { handler } = await import("../../lambda-handlers/payments-handler");

    const res = await handler(event);

    expect(console.log).toHaveBeenCalledWith("fetching secrets");

    expect(mockGetSecretValueCommand).toHaveBeenCalledTimes(2);

    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.PAYMENT_SECRET_NAME,
    });

    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.AVAILABLE_PLANS_SECRET_NAME,
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      `${process.env.PAYMENT_GATEWAY_URL}/payment-plans?status=active`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${paymentSecret}`,
          "Content-Type": "application/json",
          accept: "application/json",
        },
      }
    );

    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      `${process.env.PAYMENT_GATEWAY_URL}/payments`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${paymentSecret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tx_ref: mockUUid,
          narration: `Payment for project: ${projectName}`,
          amount: proPrice,
          currency: "NGN",
          redirect_url: "http://localhost:3000/dashboard/new",
          customer: {
            email,
            name: fullName,
          },
          customizations: {
            title: "RGBreak",
          },
          meta: {
            userId,
            planName: PlanType.Pro,
            projectName,
            usagePlanId: proUsagePlanId,
            projectId: mockUUid,
          },
          payment_options: "card",
        }),
      }
    );

    expect(res).toEqual({
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Api-Key",
      },
      statusCode: 200,
      body: JSON.stringify({
        data: "created charge",
      }),
    });

    expect(console.log).toHaveBeenLastCalledWith("completed successfully");
  });

  test("it should throw an error because charge request to payment gateway failed", async () => {
    const mockGetSecretValueCommand = jest
      .fn()
      .mockImplementation((commandParams) => {
        if (commandParams.SecretId === process.env.PAYMENT_SECRET_NAME) {
          return {
            SecretString: paymentSecret,
          };
        }

        if (
          commandParams.SecretId === process.env.AVAILABLE_PLANS_SECRET_NAME
        ) {
          return {
            SecretString: usagePlansSecret,
          };
        }

        throw new Error("Secret not found");
      });

    jest.mock("@aws-sdk/client-secrets-manager", () => ({
      SecretsManagerClient: jest.fn().mockImplementation(() => ({
        send: jest.fn().mockImplementation((command) => {
          return command;
        }),
      })),
      GetSecretValueCommand: mockGetSecretValueCommand,
    }));

    global.fetch = jest.fn().mockImplementation((input) => {
      if (
        input ===
        `${process.env.PAYMENT_GATEWAY_URL}/payment-plans?status=active`
      ) {
        return {
          ok: true,
          json: jest.fn().mockResolvedValue({
            data: [
              {
                id: "1",
                name: "Pro",
                amount: proPrice,
                currency: "NGN",
              },
              {
                id: "2",
                name: "Executive",
                amount: executivePrice,
                currency: "NGN",
              },
            ],
          }),
        };
      }

      return {
        ok: false,
        json: jest.fn().mockResolvedValue({
          data: "created charge",
        }),
      };
    });

    const event = {
      body: JSON.stringify({
        planName: PlanType.Pro,
        projectName,
        email,
        userId,
        fullName,
      }),
    } as unknown as APIGatewayProxyEventV2;

    const { handler } = await import("../../lambda-handlers/payments-handler");

    await expect(handler(event)).rejects.toThrow(Error);

    expect(console.log).toHaveBeenCalledWith("fetching secrets");

    expect(mockGetSecretValueCommand).toHaveBeenCalledTimes(2);

    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.PAYMENT_SECRET_NAME,
    });

    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.AVAILABLE_PLANS_SECRET_NAME,
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      `${process.env.PAYMENT_GATEWAY_URL}/payment-plans?status=active`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${paymentSecret}`,
          "Content-Type": "application/json",
          accept: "application/json",
        },
      }
    );

    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      `${process.env.PAYMENT_GATEWAY_URL}/payments`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${paymentSecret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tx_ref: mockUUid,
          narration: `Payment for project: ${projectName}`,
          amount: proPrice,
          currency: "NGN",
          redirect_url: "http://localhost:3000/dashboard/new",
          customer: {
            email,
            name: fullName,
          },
          customizations: {
            title: "RGBreak",
          },
          meta: {
            userId,
            planName: PlanType.Pro,
            projectName,
            usagePlanId: proUsagePlanId,
            projectId: mockUUid,
          },
          payment_options: "card",
        }),
      }
    );

    expect(console.error).toHaveBeenCalledTimes(1);
  });

  test("it should create a free project for the user since they have not reached the max", async () => {
    const mockGetSecretValueCommand = jest
      .fn()
      .mockImplementation((commandParams) => {
        if (commandParams.SecretId === process.env.PAYMENT_SECRET_NAME) {
          return {
            SecretString: paymentSecret,
          };
        }

        if (
          commandParams.SecretId === process.env.AVAILABLE_PLANS_SECRET_NAME
        ) {
          return {
            SecretString: usagePlansSecret,
          };
        }

        throw new Error("Secret not found");
      });

    jest.mock("@aws-sdk/client-secrets-manager", () => ({
      SecretsManagerClient: jest.fn().mockImplementation(() => ({
        send: jest.fn().mockImplementation((command) => {
          return command;
        }),
      })),
      GetSecretValueCommand: mockGetSecretValueCommand,
    }));

    global.fetch = jest.fn().mockImplementation((input) => {
      if (
        input ===
        `${process.env.PAYMENT_GATEWAY_URL}/payment-plans?status=active`
      ) {
        return {
          ok: true,
          json: jest.fn().mockResolvedValue({
            data: [
              {
                id: "1",
                name: "Pro",
                amount: proPrice,
                currency: "NGN",
              },
              {
                id: "2",
                name: "Executive",
                amount: executivePrice,
                currency: "NGN",
              },
              {
                id: "3",
                name: "Free",
                amount: 0,
                currency: "NGN",
              },
            ],
          }),
        };
      }

      return {
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: "created charge",
        }),
      };
    });

    const mockQueryCommand = jest.fn().mockImplementation((commandParams) => {
      return {
        Items: [],
      };
    });

    const mockPutCommand = jest.fn();

    jest.mock("@aws-sdk/lib-dynamodb", () => ({
      DynamoDBDocumentClient: {
        from: jest.fn().mockImplementation(() => ({
          send: jest.fn().mockImplementation((command) => {
            return command;
          }),
        })),
      },
      PutCommand: mockPutCommand,
      QueryCommand: mockQueryCommand,
    }));

    const mockApiKeyId = "mockId";
    const mockApiKeyValue = "mockValue";

    const mockCreateApiKeyCommand = jest
      .fn()
      .mockImplementation((commandParams) => {
        return {
          id: mockApiKeyId,
          value: mockApiKeyValue,
        };
      });

    const mockCreateUsagePlanKeyCommand = jest.fn();

    jest.mock("@aws-sdk/client-api-gateway", () => ({
      APIGatewayClient: jest.fn().mockImplementation(() => ({
        send: jest.fn().mockImplementation((command) => {
          return command;
        }),
      })),

      CreateApiKeyCommand: mockCreateApiKeyCommand,

      CreateUsagePlanKeyCommand: mockCreateUsagePlanKeyCommand,
    }));

    const event = {
      body: JSON.stringify({
        planName: "free",
        projectName,
        email,
        userId,
        fullName,
      }),
    } as unknown as APIGatewayProxyEventV2;

    const { handler } = await import("../../lambda-handlers/payments-handler");

    const res = await handler(event);

    expect(console.log).toHaveBeenCalledWith("fetching secrets");

    expect(mockGetSecretValueCommand).toHaveBeenCalledTimes(2);

    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.PAYMENT_SECRET_NAME,
    });

    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.AVAILABLE_PLANS_SECRET_NAME,
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      `${process.env.PAYMENT_GATEWAY_URL}/payment-plans?status=active`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${paymentSecret}`,
          "Content-Type": "application/json",
          accept: "application/json",
        },
      }
    );

    expect(mockQueryCommand).toHaveBeenCalledTimes(1);

    expect(mockQueryCommand).toHaveBeenCalledWith({
      TableName: process.env.TABLE_NAME!,
      IndexName: "userIdSubStatusIndex",
      KeyConditionExpression: "userId = :userId and sub_status = :status",
      ExpressionAttributeValues: {
        ":userId": userId,
        ":status": planTypeToStatus[PlanType.Free],
      },
      Limit: maxActiveFreeProjects,
    });

    expect(mockCreateApiKeyCommand).toHaveBeenCalledTimes(1);

    expect(mockCreateApiKeyCommand).toHaveBeenCalledWith({
      value: mockUUid,
      name: `${projectName.replace(" ", "_")}_${userId}`,
      enabled: true,
    });

    expect(mockCreateUsagePlanKeyCommand).toHaveBeenCalledTimes(1);
    expect(mockCreateUsagePlanKeyCommand).toHaveBeenCalledWith({
      usagePlanId: freeUsagePlanId,
      keyId: mockApiKeyId,
      keyType: "API_KEY",
    });

    expect(mockPutCommand).toHaveBeenCalledTimes(1);

    expect(mockPutCommand).toHaveBeenCalledWith({
      TableName: process.env.TABLE_NAME!,
      Item: {
        email,
        userId,
        projectId,
        apiKeyInfo: {
          apiKeyId: mockApiKeyId,
          usagePlanId: freeUsagePlanId,
        },
        currentPlan: PlanType.Free,
        projectName,
        cardTokenInfo: {
          cardToken: "",
          cardExpiry: "",
        },
        apiKey: mockApiKeyValue,
        nextPaymentDate: expect.any(Number),
        sub_status: planTypeToStatus[PlanType.Free],
        currentBillingDate: expect.any(Number),
        createdAt: expect.any(Number),
      },
    });

    expect(res).toEqual({
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Api-Key",
      },
      statusCode: 200,
      body: JSON.stringify({
        message: "Api key generated",
      }),
    });
  });

  test("it should not create a free project for the user since they have reached the max", async () => {
    const mockGetSecretValueCommand = jest
      .fn()
      .mockImplementation((commandParams) => {
        if (commandParams.SecretId === process.env.PAYMENT_SECRET_NAME) {
          return {
            SecretString: paymentSecret,
          };
        }

        if (
          commandParams.SecretId === process.env.AVAILABLE_PLANS_SECRET_NAME
        ) {
          return {
            SecretString: usagePlansSecret,
          };
        }

        throw new Error("Secret not found");
      });

    jest.mock("@aws-sdk/client-secrets-manager", () => ({
      SecretsManagerClient: jest.fn().mockImplementation(() => ({
        send: jest.fn().mockImplementation((command) => {
          return command;
        }),
      })),
      GetSecretValueCommand: mockGetSecretValueCommand,
    }));

    global.fetch = jest.fn().mockImplementation((input) => {
      if (
        input ===
        `${process.env.PAYMENT_GATEWAY_URL}/payment-plans?status=active`
      ) {
        return {
          ok: true,
          json: jest.fn().mockResolvedValue({
            data: [
              {
                id: "1",
                name: "Pro",
                amount: proPrice,
                currency: "NGN",
              },
              {
                id: "2",
                name: "Executive",
                amount: executivePrice,
                currency: "NGN",
              },
              {
                id: "3",
                name: "Free",
                amount: 0,
                currency: "NGN",
              },
            ],
          }),
        };
      }

      return {
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: "created charge",
        }),
      };
    });

    const mockQueryCommand = jest.fn().mockImplementation((commandParams) => {
      return {
        Items: [1, 2, 3],
      };
    });

    const mockPutCommand = jest.fn();

    jest.mock("@aws-sdk/lib-dynamodb", () => ({
      DynamoDBDocumentClient: {
        from: jest.fn().mockImplementation(() => ({
          send: jest.fn().mockImplementation((command) => {
            return command;
          }),
        })),
      },
      PutCommand: mockPutCommand,
      QueryCommand: mockQueryCommand,
    }));

    const mockApiKeyId = "mockId";
    const mockApiKeyValue = "mockValue";

    const mockCreateApiKeyCommand = jest
      .fn()
      .mockImplementation((commandParams) => {
        return {
          id: mockApiKeyId,
          value: mockApiKeyValue,
        };
      });

    const mockCreateUsagePlanKeyCommand = jest.fn();

    jest.mock("@aws-sdk/client-api-gateway", () => ({
      APIGatewayClient: jest.fn().mockImplementation(() => ({
        send: jest.fn().mockImplementation((command) => {
          return command;
        }),
      })),

      CreateApiKeyCommand: mockCreateApiKeyCommand,

      CreateUsagePlanKeyCommand: mockCreateUsagePlanKeyCommand,
    }));

    const event = {
      body: JSON.stringify({
        planName: "free",
        projectName,
        email,
        userId,
        fullName,
      }),
    } as unknown as APIGatewayProxyEventV2;

    const { handler } = await import("../../lambda-handlers/payments-handler");

    const res = await handler(event);

    expect(console.log).toHaveBeenCalledWith("fetching secrets");

    expect(mockGetSecretValueCommand).toHaveBeenCalledTimes(2);

    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.PAYMENT_SECRET_NAME,
    });

    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.AVAILABLE_PLANS_SECRET_NAME,
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      `${process.env.PAYMENT_GATEWAY_URL}/payment-plans?status=active`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${paymentSecret}`,
          "Content-Type": "application/json",
          accept: "application/json",
        },
      }
    );

    expect(mockQueryCommand).toHaveBeenCalledTimes(1);

    expect(mockQueryCommand).toHaveBeenCalledWith({
      TableName: process.env.TABLE_NAME!,
      IndexName: "userIdSubStatusIndex",
      KeyConditionExpression: "userId = :userId and sub_status = :status",
      ExpressionAttributeValues: {
        ":userId": userId,
        ":status": planTypeToStatus[PlanType.Free],
      },
      Limit: maxActiveFreeProjects,
    });

    expect(res).toEqual({
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Api-Key",
      },
      statusCode: 400,
      body: JSON.stringify({
        message: "You have reached the limit for free projects.",
      }),
    });
  });

  test("it should convert an existing project to a free project", async () => {
    const mockGetSecretValueCommand = jest
      .fn()
      .mockImplementation((commandParams) => {
        if (commandParams.SecretId === process.env.PAYMENT_SECRET_NAME) {
          return {
            SecretString: paymentSecret,
          };
        }

        if (
          commandParams.SecretId === process.env.AVAILABLE_PLANS_SECRET_NAME
        ) {
          return {
            SecretString: usagePlansSecret,
          };
        }

        throw new Error("Secret not found");
      });

    jest.mock("@aws-sdk/client-secrets-manager", () => ({
      SecretsManagerClient: jest.fn().mockImplementation(() => ({
        send: jest.fn().mockImplementation((command) => {
          return command;
        }),
      })),
      GetSecretValueCommand: mockGetSecretValueCommand,
    }));

    global.fetch = jest.fn().mockImplementation((input) => {
      if (
        input ===
        `${process.env.PAYMENT_GATEWAY_URL}/payment-plans?status=active`
      ) {
        return {
          ok: true,
          json: jest.fn().mockResolvedValue({
            data: [
              {
                id: "1",
                name: "Pro",
                amount: proPrice,
                currency: "NGN",
              },
              {
                id: "2",
                name: "Executive",
                amount: executivePrice,
                currency: "NGN",
              },
              {
                id: "3",
                name: "Free",
                amount: 0,
                currency: "NGN",
              },
            ],
          }),
        };
      }

      return {
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: "created charge",
        }),
      };
    });

    const mockQueryCommand = jest.fn().mockImplementation(() => {
      return {
        Items: [],
      };
    });

    const mockPutCommand = jest.fn();

    const mockApiKeyId = "mockId";
    const oldUsagePlanId = "oldUsagePlanId";

    const mockUpdateCommand = jest.fn();
    const mockGetCommand = jest.fn().mockImplementation(() => {
      return {
        Item: {
          apiKeyInfo: {
            apiKeyId: mockApiKeyId,
            usagePlanId: oldUsagePlanId,
          },

          sub_status: planTypeToStatus[PlanType.Pro],
        },
      };
    });

    jest.mock("@aws-sdk/lib-dynamodb", () => ({
      DynamoDBDocumentClient: {
        from: jest.fn().mockImplementation(() => ({
          send: jest.fn().mockImplementation((command) => {
            return command;
          }),
        })),
      },
      GetCommand: mockGetCommand,
      PutCommand: mockPutCommand,
      QueryCommand: mockQueryCommand,
      UpdateCommand: mockUpdateCommand,
    }));

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

    const event = {
      body: JSON.stringify({
        planName: "free",
        projectName,
        email,
        userId,
        fullName,
        projectId,
      }),
    } as unknown as APIGatewayProxyEventV2;

    const { handler } = await import("../../lambda-handlers/payments-handler");

    const res = await handler(event);

    expect(console.log).toHaveBeenCalledWith("fetching secrets");

    expect(mockGetSecretValueCommand).toHaveBeenCalledTimes(2);

    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.PAYMENT_SECRET_NAME,
    });

    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.AVAILABLE_PLANS_SECRET_NAME,
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      `${process.env.PAYMENT_GATEWAY_URL}/payment-plans?status=active`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${paymentSecret}`,
          "Content-Type": "application/json",
          accept: "application/json",
        },
      }
    );

    expect(mockQueryCommand).toHaveBeenCalledTimes(1);

    expect(mockQueryCommand).toHaveBeenCalledWith({
      TableName: process.env.TABLE_NAME!,
      IndexName: "userIdSubStatusIndex",
      KeyConditionExpression: "userId = :userId and sub_status = :status",
      ExpressionAttributeValues: {
        ":userId": userId,
        ":status": planTypeToStatus[PlanType.Free],
      },
      Limit: maxActiveFreeProjects,
    });

    expect(mockGetUsagePlanKeyCommand).toHaveBeenCalledTimes(2);

    expect(mockGetUsagePlanKeyCommand).toHaveBeenNthCalledWith(1, {
      keyId: mockApiKeyId,
      usagePlanId: oldUsagePlanId,
    });

    expect(mockGetUsagePlanKeyCommand).toHaveBeenNthCalledWith(2, {
      keyId: mockApiKeyId,
      usagePlanId: freeUsagePlanId,
    });

    expect(mockDeleteUsagePlanKeyCommand).toHaveBeenCalledTimes(1);

    expect(mockDeleteUsagePlanKeyCommand).toHaveBeenCalledWith({
      keyId: mockApiKeyId,
      usagePlanId: oldUsagePlanId,
    });

    expect(mockUpdateCommand).toHaveBeenCalledTimes(1);

    expect(mockUpdateCommand).toHaveBeenCalledWith({
      TableName: process.env.TABLE_NAME!,
      Key: {
        userId,
        projectId,
      },
      ExpressionAttributeValues: {
        ":currentPlan": PlanType.Free,
        ":usagePlanId": freeUsagePlanId,
        ":sub_status": planTypeToStatus[PlanType.Free],
      },
      UpdateExpression:
        "set sub_status = :sub_status, currentPlan = :currentPlan, apiKeyInfo.usagePlanId = :usagePlanId",
    });
  });

  test("it should return a 400 error because no body was provided", async () => {
    const event = {
      body: null,
    } as unknown as APIGatewayProxyEventV2;

    const { handler } = await import("../../lambda-handlers/payments-handler");

    const res = await handler(event);

    expect(res).toEqual({
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Api-Key",
      },
      statusCode: 400,
      body: JSON.stringify({
        message: "Bad Request - No body",
      }),
    });
  });

  test("it should return a 400 error because the body is invalid", async () => {
    const event = {
      body: JSON.stringify({
        planName: null,
        projectName,
        email,
        userId,
        fullName,
      }),
    } as unknown as APIGatewayProxyEventV2;

    const { handler } = await import("../../lambda-handlers/payments-handler");

    const res = await handler(event);

    expect(res).toEqual({
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Api-Key",
      },
      statusCode: 400,
      body: expect.any(String),
    });
  });

  test("it should return a 404 because project was not found", async () => {
    const mockGetSecretValueCommand = jest
      .fn()
      .mockImplementation((commandParams) => {
        if (commandParams.SecretId === process.env.PAYMENT_SECRET_NAME) {
          return {
            SecretString: paymentSecret,
          };
        }

        if (
          commandParams.SecretId === process.env.AVAILABLE_PLANS_SECRET_NAME
        ) {
          return {
            SecretString: usagePlansSecret,
          };
        }

        throw new Error("Secret not found");
      });

    jest.mock("@aws-sdk/client-secrets-manager", () => ({
      SecretsManagerClient: jest.fn().mockImplementation(() => ({
        send: jest.fn().mockImplementation((command) => {
          return command;
        }),
      })),
      GetSecretValueCommand: mockGetSecretValueCommand,
    }));

    const mockGetCommand = jest.fn().mockImplementation((commandParams) => {
      return {
        Item: null,
      };
    });

    jest.mock("@aws-sdk/lib-dynamodb", () => ({
      DynamoDBDocumentClient: {
        from: jest.fn().mockImplementation(() => ({
          send: jest.fn().mockImplementation((command) => {
            return command;
          }),
        })),
      },
      GetCommand: mockGetCommand,
    }));

    global.fetch = jest.fn().mockImplementation((input) => {
      if (
        input ===
        `${process.env.PAYMENT_GATEWAY_URL}/payment-plans?status=active`
      ) {
        return {
          ok: true,
          json: jest.fn().mockResolvedValue({
            data: [
              {
                id: "1",
                name: "Pro",
                amount: proPrice,
                currency: "NGN",
              },
              {
                id: "2",
                name: "Executive",
                amount: executivePrice,
                currency: "NGN",
              },
            ],
          }),
        };
      }

      return {
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: "created charge",
        }),
      };
    });

    const event = {
      body: JSON.stringify({
        planName: PlanType.Pro,
        projectName,
        email,
        userId,
        fullName,
        projectId,
      }),
    } as unknown as APIGatewayProxyEventV2;

    const { handler } = await import("../../lambda-handlers/payments-handler");

    const res = await handler(event);

    expect(res).toEqual({
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Api-Key",
      },
      statusCode: 404,
      body: JSON.stringify({
        message: "Project Not Found",
      }),
    });

    expect(mockGetCommand).toHaveBeenCalledWith({
      TableName: process.env.TABLE_NAME!,
      Key: {
        userId,
        projectId,
      },
      ProjectionExpression: "apiKeyInfo, sub_status",
    });
  });

  test("it should throw an error because it failed to get plans from payment gateway", async () => {
    const mockGetSecretValueCommand = jest
      .fn()
      .mockImplementation((commandParams) => {
        if (commandParams.SecretId === process.env.PAYMENT_SECRET_NAME) {
          return {
            SecretString: paymentSecret,
          };
        }

        if (
          commandParams.SecretId === process.env.AVAILABLE_PLANS_SECRET_NAME
        ) {
          return {
            SecretString: usagePlansSecret,
          };
        }

        throw new Error("Secret not found");
      });

    jest.mock("@aws-sdk/client-secrets-manager", () => ({
      SecretsManagerClient: jest.fn().mockImplementation(() => ({
        send: jest.fn().mockImplementation((command) => {
          return command;
        }),
      })),
      GetSecretValueCommand: mockGetSecretValueCommand,
    }));

    global.fetch = jest.fn().mockImplementation((input) => {
      if (
        input ===
        `${process.env.PAYMENT_GATEWAY_URL}/payment-plans?status=active`
      ) {
        return {
          ok: false,
          json: jest.fn().mockResolvedValue({
            data: [
              {
                id: "1",
                name: "Pro",
                amount: proPrice,
                currency: "NGN",
              },
              {
                id: "2",
                name: "Executive",
                amount: executivePrice,
                currency: "NGN",
              },
            ],
          }),
        };
      }

      return {
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: "created charge",
        }),
      };
    });

    const event = {
      body: JSON.stringify({
        planName: PlanType.Pro,
        projectName,
        email,
        userId,
        fullName,
      }),
    } as unknown as APIGatewayProxyEventV2;

    const { handler } = await import("../../lambda-handlers/payments-handler");

    await expect(handler(event)).rejects.toThrow(Error);

    expect(console.log).toHaveBeenCalledWith("fetching secrets");

    expect(mockGetSecretValueCommand).toHaveBeenCalledTimes(2);

    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.PAYMENT_SECRET_NAME,
    });

    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.AVAILABLE_PLANS_SECRET_NAME,
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      `${process.env.PAYMENT_GATEWAY_URL}/payment-plans?status=active`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${paymentSecret}`,
          "Content-Type": "application/json",
          accept: "application/json",
        },
      }
    );
  });

  test("it should throw an error because secretstring for payment secret was empty", async () => {
    const mockGetSecretValueCommand = jest
      .fn()
      .mockImplementation((commandParams) => {
        if (commandParams.SecretId === process.env.PAYMENT_SECRET_NAME) {
          return {
            SecretString: null,
          };
        }

        if (
          commandParams.SecretId === process.env.AVAILABLE_PLANS_SECRET_NAME
        ) {
          return {
            SecretString: usagePlansSecret,
          };
        }

        throw new Error("Secret not found");
      });

    jest.mock("@aws-sdk/client-secrets-manager", () => ({
      SecretsManagerClient: jest.fn().mockImplementation(() => ({
        send: jest.fn().mockImplementation((command) => {
          return command;
        }),
      })),
      GetSecretValueCommand: mockGetSecretValueCommand,
    }));

    global.fetch = jest.fn().mockImplementation((input) => {
      if (
        input ===
        `${process.env.PAYMENT_GATEWAY_URL}/payment-plans?status=active`
      ) {
        return {
          ok: true,
          json: jest.fn().mockResolvedValue({
            data: [
              {
                id: "1",
                name: "Pro",
                amount: proPrice,
                currency: "NGN",
              },
              {
                id: "2",
                name: "Executive",
                amount: executivePrice,
                currency: "NGN",
              },
            ],
          }),
        };
      }

      return {
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: "created charge",
        }),
      };
    });

    const event = {
      body: JSON.stringify({
        planName: PlanType.Pro,
        projectName,
        email,
        userId,
        fullName,
      }),
    } as unknown as APIGatewayProxyEventV2;

    const { handler } = await import("../../lambda-handlers/payments-handler");

    await expect(handler(event)).rejects.toThrow(Error);

    expect(console.log).toHaveBeenCalledWith("fetching secrets");

    expect(mockGetSecretValueCommand).toHaveBeenCalledTimes(2);

    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.PAYMENT_SECRET_NAME,
    });

    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.AVAILABLE_PLANS_SECRET_NAME,
    });

    expect(global.fetch).toHaveBeenCalledTimes(0);
  });
});
