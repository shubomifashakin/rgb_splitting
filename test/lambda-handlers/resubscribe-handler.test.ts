import { PlanType, planTypeToStatus } from "../../helpers/constants";

console.log = jest.fn();
console.error = jest.fn();

const batchLimit = 1000;

const proProjectId = "b2d3e8f6-1a2b-3c4d-5e6f-7a8b9c0d1e2f";
const executiveProjectId = "c3d3e8f6-1a2b-3c4d-5e6f-7a8b9c0d1e2z";

describe("resubscribe handler test", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    process.env.REGION = "fake-region";
    process.env.TABLE_NAME = "fake-table";
    process.env.PAYMENT_GATEWAY_URL = "fake-payment-gateway-url";
    process.env.PAYMENT_SECRET_NAME = "fake-payment-secret-name";
    process.env.AVAILABLE_PLANS_SECRET_NAME =
      "fake-available-plans-secret-name";
    process.env.RESUBSCRIBE_QUEUE_URL = "fake-resubscribe-queue-url";
    process.env.DOWNGRADE_SUBSCRIPTION_QUEUE_URL =
      "fake-downgrade-subscription-queue-url";
  });

  test("it should not resubscribe any project since no project was found", async () => {
    const mockQueryCommand = jest.fn().mockResolvedValue({
      Items: [],
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
        QueryCommand: mockQueryCommand,
      };
    });

    const { handler } = await import("../../lambda-handlers/resubscribe");

    await handler();

    expect(console.log).toHaveBeenCalledWith("event", undefined);

    expect(console.log).toHaveBeenCalledWith("STARTING CURSORS", undefined);

    expect(mockQueryCommand).toHaveBeenCalledTimes(2);
    expect(mockQueryCommand).toHaveBeenCalledWith({
      IndexName: "expiredSubscriptionIndex",
      TableName: process.env.TABLE_NAME!,
      KeyConditionExpression:
        "sub_status = :status AND nextPaymentDate <= :currentDate",
      ExpressionAttributeValues: {
        ":currentDate": expect.any(Number),
        ":status": planTypeToStatus[PlanType.Pro],
      },
      ProjectionExpression:
        "projectId, email, userId, projectName, nextPaymentDate, currentPlan, cardTokenInfo",
      Limit: batchLimit,
      ExclusiveStartKey: undefined,
    });

    expect(mockQueryCommand).toHaveBeenCalledWith({
      IndexName: "expiredSubscriptionIndex",
      TableName: process.env.TABLE_NAME!,
      KeyConditionExpression:
        "sub_status = :status AND nextPaymentDate <= :currentDate",
      ExpressionAttributeValues: {
        ":currentDate": expect.any(Number),
        ":status": planTypeToStatus[PlanType.Executive],
      },
      ProjectionExpression:
        "projectId, email, userId, projectName, nextPaymentDate, currentPlan, cardTokenInfo",
      Limit: batchLimit,
      ExclusiveStartKey: undefined,
    });

    expect(console.log).toHaveBeenCalledWith(
      "found no projects with expired subscriptions"
    );
  });

  test("it should resubscribe all the projects & trigger the next queue", async () => {
    const projectEmail = "test@email.com";

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
                amount: 1000,
                currency: "NGN",
              },
              {
                id: "2",
                name: "Executive",
                amount: 2000,
                currency: "NGN",
              },
            ],
          }),
        };
      }

      if (input === `${process.env.PAYMENT_GATEWAY_URL}/tokenized-charges`) {
        return {
          ok: true,
        };
      }

      throw new Error("failed to fetch plans from payment gateway");
    });

    const mockQueryCommand = jest.fn().mockImplementation((params) => {
      return {
        Items: [
          {
            projectId:
              params.ExpressionAttributeValues[":status"] ===
              planTypeToStatus[PlanType.Pro]
                ? proProjectId
                : executiveProjectId,
            email: projectEmail,
            userId: "4d5e6f7a-8b9c-0d1e-2f3a-4b5c6d7e8f9a",
            projectName: "project-name",
            nextPaymentDate: 1,
            currentPlan:
              params.ExpressionAttributeValues[":status"] ===
              planTypeToStatus[PlanType.Pro]
                ? PlanType.Pro
                : PlanType.Executive,
            cardTokenInfo: {
              cardToken: "card-token",
              cardTokenExpiryDate: "card-token-expiry-date",
            },
          },
        ],
        LastEvaluatedKey: "fake last evaluated string",
      };
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
        QueryCommand: mockQueryCommand,
      };
    });

    const mockGetSecretValueCommand = jest.fn().mockImplementation((params) => {
      if (params.SecretId === process.env.PAYMENT_SECRET_NAME) {
        return {
          SecretString: "payment-secret",
        };
      }

      if (params.SecretId === process.env.AVAILABLE_PLANS_SECRET_NAME) {
        return {
          SecretString: JSON.stringify({
            executive: "executive",
            pro: "pro",
            free: "free",
          }),
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

    const mockSendMessageCommand = jest.fn();

    jest.mock("@aws-sdk/client-sqs", () => {
      return {
        SQSClient: jest.fn().mockImplementation(() => ({
          send: jest.fn().mockImplementation((command) => {
            return command;
          }),
        })),
        SendMessageCommand: mockSendMessageCommand,
      };
    });

    const { handler } = await import("../../lambda-handlers/resubscribe");

    await handler();

    expect(console.log).toHaveBeenCalledWith("event", undefined);

    expect(console.log).toHaveBeenCalledWith("STARTING CURSORS", undefined);

    expect(mockQueryCommand).toHaveBeenCalledTimes(2);
    expect(mockQueryCommand).toHaveBeenCalledWith({
      IndexName: "expiredSubscriptionIndex",
      TableName: process.env.TABLE_NAME!,
      KeyConditionExpression:
        "sub_status = :status AND nextPaymentDate <= :currentDate",
      ExpressionAttributeValues: {
        ":currentDate": expect.any(Number),
        ":status": planTypeToStatus[PlanType.Pro],
      },
      ProjectionExpression:
        "projectId, email, userId, projectName, nextPaymentDate, currentPlan, cardTokenInfo",
      Limit: batchLimit,
      ExclusiveStartKey: undefined,
    });

    expect(mockQueryCommand).toHaveBeenCalledWith({
      IndexName: "expiredSubscriptionIndex",
      TableName: process.env.TABLE_NAME!,
      KeyConditionExpression:
        "sub_status = :status AND nextPaymentDate <= :currentDate",
      ExpressionAttributeValues: {
        ":currentDate": expect.any(Number),
        ":status": planTypeToStatus[PlanType.Executive],
      },
      ProjectionExpression:
        "projectId, email, userId, projectName, nextPaymentDate, currentPlan, cardTokenInfo",
      Limit: batchLimit,
      ExclusiveStartKey: undefined,
    });

    expect(console.log).toHaveBeenCalledWith("fetching secrets");

    expect(mockGetSecretValueCommand).toHaveBeenCalledTimes(2);
    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.PAYMENT_SECRET_NAME,
    });
    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.AVAILABLE_PLANS_SECRET_NAME,
    });

    expect(mockSendMessageCommand).toHaveBeenCalledTimes(1);
    expect(mockSendMessageCommand).toHaveBeenCalledWith({
      QueueUrl: process.env.RESUBSCRIBE_QUEUE_URL,
      MessageBody: JSON.stringify({
        pro: "fake last evaluated string",
        exec: "fake last evaluated string",
      }),
    });

    expect(console.log).toHaveBeenCalledWith(
      `charged ${projectEmail} with project ${proProjectId} successfully`
    );

    expect(console.log).toHaveBeenCalledWith(
      `charged ${projectEmail} with project ${executiveProjectId} successfully`
    );

    expect(console.log).toHaveBeenCalledWith("completed successfully");
  });

  test("it should resubscribe all the projects & not trigger the next queue since there are no last eval keys", async () => {
    const projectEmail = "test@email.com";

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
                amount: 1000,
                currency: "NGN",
              },
              {
                id: "2",
                name: "Executive",
                amount: 2000,
                currency: "NGN",
              },
            ],
          }),
        };
      }

      if (input === `${process.env.PAYMENT_GATEWAY_URL}/tokenized-charges`) {
        return {
          ok: true,
        };
      }

      throw new Error("failed to fetch plans from payment gateway");
    });

    const mockQueryCommand = jest.fn().mockImplementation((params) => {
      return {
        Items: [
          {
            projectId:
              params.ExpressionAttributeValues[":status"] ===
              planTypeToStatus[PlanType.Pro]
                ? proProjectId
                : executiveProjectId,
            email: projectEmail,
            userId: "4d5e6f7a-8b9c-0d1e-2f3a-4b5c6d7e8f9a",
            projectName: "project-name",
            nextPaymentDate: 1,
            currentPlan:
              params.ExpressionAttributeValues[":status"] ===
              planTypeToStatus[PlanType.Pro]
                ? PlanType.Pro
                : PlanType.Executive,
            cardTokenInfo: {
              cardToken: "card-token",
              cardTokenExpiryDate: "card-token-expiry-date",
            },
          },
        ],
        LastEvaluatedKey: null,
      };
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
        QueryCommand: mockQueryCommand,
      };
    });

    const mockGetSecretValueCommand = jest.fn().mockImplementation((params) => {
      if (params.SecretId === process.env.PAYMENT_SECRET_NAME) {
        return {
          SecretString: "payment-secret",
        };
      }

      if (params.SecretId === process.env.AVAILABLE_PLANS_SECRET_NAME) {
        return {
          SecretString: JSON.stringify({
            executive: "executive",
            pro: "pro",
            free: "free",
          }),
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

    const mockSendMessageCommand = jest.fn();

    jest.mock("@aws-sdk/client-sqs", () => {
      return {
        SQSClient: jest.fn().mockImplementation(() => ({
          send: jest.fn().mockImplementation((command) => {
            return command;
          }),
        })),
        SendMessageCommand: mockSendMessageCommand,
      };
    });

    const { handler } = await import("../../lambda-handlers/resubscribe");

    await handler();

    expect(console.log).toHaveBeenCalledWith("event", undefined);

    expect(console.log).toHaveBeenCalledWith("STARTING CURSORS", undefined);

    expect(mockQueryCommand).toHaveBeenCalledTimes(2);
    expect(mockQueryCommand).toHaveBeenCalledWith({
      IndexName: "expiredSubscriptionIndex",
      TableName: process.env.TABLE_NAME!,
      KeyConditionExpression:
        "sub_status = :status AND nextPaymentDate <= :currentDate",
      ExpressionAttributeValues: {
        ":currentDate": expect.any(Number),
        ":status": planTypeToStatus[PlanType.Pro],
      },
      ProjectionExpression:
        "projectId, email, userId, projectName, nextPaymentDate, currentPlan, cardTokenInfo",
      Limit: batchLimit,
      ExclusiveStartKey: undefined,
    });

    expect(mockQueryCommand).toHaveBeenCalledWith({
      IndexName: "expiredSubscriptionIndex",
      TableName: process.env.TABLE_NAME!,
      KeyConditionExpression:
        "sub_status = :status AND nextPaymentDate <= :currentDate",
      ExpressionAttributeValues: {
        ":currentDate": expect.any(Number),
        ":status": planTypeToStatus[PlanType.Executive],
      },
      ProjectionExpression:
        "projectId, email, userId, projectName, nextPaymentDate, currentPlan, cardTokenInfo",
      Limit: batchLimit,
      ExclusiveStartKey: undefined,
    });

    expect(console.log).toHaveBeenCalledWith("fetching secrets");

    expect(mockGetSecretValueCommand).toHaveBeenCalledTimes(2);
    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.PAYMENT_SECRET_NAME,
    });
    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.AVAILABLE_PLANS_SECRET_NAME,
    });

    expect(console.log).toHaveBeenCalledWith(
      `charged ${projectEmail} with project ${proProjectId} successfully`
    );

    expect(console.log).toHaveBeenCalledWith(
      `charged ${projectEmail} with project ${executiveProjectId} successfully`
    );

    expect(mockSendMessageCommand).toHaveBeenCalledTimes(0);

    expect(console.log).toHaveBeenCalledWith("completed successfully");
  });

  test("it should fail to resubscribe all users because fetching plans from payment gateway failed", async () => {
    const projectEmail = "test@email.com";

    const mockQueryCommand = jest.fn().mockImplementation((params) => {
      return {
        Items: [
          {
            projectId:
              params.ExpressionAttributeValues[":status"] ===
              planTypeToStatus[PlanType.Pro]
                ? proProjectId
                : executiveProjectId,
            email: projectEmail,
            userId: "4d5e6f7a-8b9c-0d1e-2f3a-4b5c6d7e8f9a",
            projectName: "project-name",
            nextPaymentDate: 1,
            currentPlan:
              params.ExpressionAttributeValues[":status"] ===
              planTypeToStatus[PlanType.Pro]
                ? PlanType.Pro
                : PlanType.Executive,
            cardTokenInfo: {
              cardToken: "card-token",
              cardTokenExpiryDate: "card-token-expiry-date",
            },
          },
        ],
        LastEvaluatedKey: "fake last evaluated string",
      };
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
        QueryCommand: mockQueryCommand,
      };
    });

    const mockGetSecretValueCommand = jest.fn().mockImplementation((params) => {
      if (params.SecretId === process.env.PAYMENT_SECRET_NAME) {
        return {
          SecretString: "payment-secret",
        };
      }

      if (params.SecretId === process.env.AVAILABLE_PLANS_SECRET_NAME) {
        return {
          SecretString: JSON.stringify({
            executive: "executive",
            pro: "pro",
            free: "free",
          }),
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
                amount: 1000,
                currency: "NGN",
              },
              {
                id: "2",
                name: "Executive",
                amount: 2000,
                currency: "NGN",
              },
            ],
          }),
        };
      }

      if (input === `${process.env.PAYMENT_GATEWAY_URL}/tokenized-charges`) {
        return {
          ok: true,
        };
      }

      throw new Error("failed to fetch plans from payment gateway");
    });

    const mockSendMessageCommand = jest.fn();

    jest.mock("@aws-sdk/client-sqs", () => {
      return {
        SQSClient: jest.fn().mockImplementation(() => ({
          send: jest.fn().mockImplementation((command) => {
            return Promise.resolve(command);
          }),
        })),
        SendMessageCommand: mockSendMessageCommand,
      };
    });

    const { handler } = await import("../../lambda-handlers/resubscribe");

    await handler();

    expect(console.log).toHaveBeenCalledWith("event", undefined);

    expect(console.log).toHaveBeenCalledWith("STARTING CURSORS", undefined);

    expect(mockQueryCommand).toHaveBeenCalledTimes(2);
    expect(mockQueryCommand).toHaveBeenCalledWith({
      IndexName: "expiredSubscriptionIndex",
      TableName: process.env.TABLE_NAME!,
      KeyConditionExpression:
        "sub_status = :status AND nextPaymentDate <= :currentDate",
      ExpressionAttributeValues: {
        ":currentDate": expect.any(Number),
        ":status": planTypeToStatus[PlanType.Pro],
      },
      ProjectionExpression:
        "projectId, email, userId, projectName, nextPaymentDate, currentPlan, cardTokenInfo",
      Limit: batchLimit,
      ExclusiveStartKey: undefined,
    });

    expect(mockQueryCommand).toHaveBeenCalledWith({
      IndexName: "expiredSubscriptionIndex",
      TableName: process.env.TABLE_NAME!,
      KeyConditionExpression:
        "sub_status = :status AND nextPaymentDate <= :currentDate",
      ExpressionAttributeValues: {
        ":currentDate": expect.any(Number),
        ":status": planTypeToStatus[PlanType.Executive],
      },
      ProjectionExpression:
        "projectId, email, userId, projectName, nextPaymentDate, currentPlan, cardTokenInfo",
      Limit: batchLimit,
      ExclusiveStartKey: undefined,
    });

    expect(console.log).toHaveBeenCalledWith("fetching secrets");

    expect(mockGetSecretValueCommand).toHaveBeenCalledTimes(2);
    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.PAYMENT_SECRET_NAME,
    });
    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.AVAILABLE_PLANS_SECRET_NAME,
    });

    expect(mockSendMessageCommand).toHaveBeenCalledTimes(3);

    expect(mockSendMessageCommand).toHaveBeenNthCalledWith(1, {
      QueueUrl: process.env.DOWNGRADE_SUBSCRIPTION_QUEUE_URL,
      MessageBody: JSON.stringify({
        projectId: proProjectId,
        email: projectEmail,
        userId: "4d5e6f7a-8b9c-0d1e-2f3a-4b5c6d7e8f9a",
        projectName: "project-name",
        nextPaymentDate: 1,
        currentPlan: PlanType.Pro,
        cardTokenInfo: {
          cardToken: "card-token",
          cardTokenExpiryDate: "card-token-expiry-date",
        },
      }),
    });

    expect(mockSendMessageCommand).toHaveBeenNthCalledWith(2, {
      QueueUrl: process.env.DOWNGRADE_SUBSCRIPTION_QUEUE_URL,
      MessageBody: JSON.stringify({
        projectId: executiveProjectId,
        email: projectEmail,
        userId: "4d5e6f7a-8b9c-0d1e-2f3a-4b5c6d7e8f9a",
        projectName: "project-name",
        nextPaymentDate: 1,
        currentPlan: PlanType.Executive,
        cardTokenInfo: {
          cardToken: "card-token",
          cardTokenExpiryDate: "card-token-expiry-date",
        },
      }),
    });

    expect(console.error).toHaveBeenCalledTimes(4);
    expect(console.error).toHaveBeenNthCalledWith(
      1,
      "Error charging user: test@email.com",
      expect.any(Error)
    );
    expect(console.error).toHaveBeenNthCalledWith(
      2,
      "Error charging user: test@email.com",
      expect.any(Error)
    );

    expect(console.log).toHaveBeenCalledWith(
      `SENDING PROJECT WITH ID: ${proProjectId} TO DOWNGRADE QUEUE`
    );

    expect(console.log).toHaveBeenCalledWith(
      `SENDING PROJECT WITH ID: ${executiveProjectId} TO DOWNGRADE QUEUE`
    );

    expect(console.error).toHaveBeenNthCalledWith(
      3,
      "Error charging user: test@email.com",
      expect.any(Error)
    );

    expect(console.error).toHaveBeenNthCalledWith(
      4,
      "Error charging user: test@email.com",
      expect.any(Error)
    );

    expect(mockSendMessageCommand).toHaveBeenNthCalledWith(3, {
      QueueUrl: process.env.RESUBSCRIBE_QUEUE_URL,
      MessageBody: JSON.stringify({
        pro: "fake last evaluated string",
        exec: "fake last evaluated string",
      }),
    });

    expect(console.log).toHaveBeenCalledWith("completed successfully");
  });

  test("it should fail to resubscribe all users because it failed to charge users due to network error", async () => {
    const projectEmail = "test@email.com";

    const mockQueryCommand = jest.fn().mockImplementation((params) => {
      return {
        Items: [
          {
            projectId:
              params.ExpressionAttributeValues[":status"] ===
              planTypeToStatus[PlanType.Pro]
                ? proProjectId
                : executiveProjectId,
            email: projectEmail,
            userId: "4d5e6f7a-8b9c-0d1e-2f3a-4b5c6d7e8f9a",
            projectName: "project-name",
            nextPaymentDate: 1,
            currentPlan:
              params.ExpressionAttributeValues[":status"] ===
              planTypeToStatus[PlanType.Pro]
                ? PlanType.Pro
                : PlanType.Executive,
            cardTokenInfo: {
              cardToken: "card-token",
              cardTokenExpiryDate: "card-token-expiry-date",
            },
          },
        ],
        LastEvaluatedKey: "fake last evaluated string",
      };
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
        QueryCommand: mockQueryCommand,
      };
    });

    const mockGetSecretValueCommand = jest.fn().mockImplementation((params) => {
      if (params.SecretId === process.env.PAYMENT_SECRET_NAME) {
        return {
          SecretString: "payment-secret",
        };
      }

      if (params.SecretId === process.env.AVAILABLE_PLANS_SECRET_NAME) {
        return {
          SecretString: JSON.stringify({
            executive: "executive",
            pro: "pro",
            free: "free",
          }),
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
                amount: 1000,
                currency: "NGN",
              },
              {
                id: "2",
                name: "Executive",
                amount: 2000,
                currency: "NGN",
              },
            ],
          }),
        };
      }

      if (input === `${process.env.PAYMENT_GATEWAY_URL}/tokenized-charges`) {
        return {
          ok: false,
          status: 500,
          json: jest.fn().mockResolvedValue({
            message: "failed to charge user",
          }),
        };
      }

      throw new Error("failed to fetch plans from payment gateway");
    });

    const mockSendMessageCommand = jest.fn();

    jest.mock("@aws-sdk/client-sqs", () => {
      return {
        SQSClient: jest.fn().mockImplementation(() => ({
          send: jest.fn().mockImplementation((command) => {
            return Promise.resolve(command);
          }),
        })),
        SendMessageCommand: mockSendMessageCommand,
      };
    });

    const { handler } = await import("../../lambda-handlers/resubscribe");

    await handler();

    expect(console.log).toHaveBeenCalledWith("event", undefined);

    expect(console.log).toHaveBeenCalledWith("STARTING CURSORS", undefined);

    expect(mockQueryCommand).toHaveBeenCalledTimes(2);
    expect(mockQueryCommand).toHaveBeenCalledWith({
      IndexName: "expiredSubscriptionIndex",
      TableName: process.env.TABLE_NAME!,
      KeyConditionExpression:
        "sub_status = :status AND nextPaymentDate <= :currentDate",
      ExpressionAttributeValues: {
        ":currentDate": expect.any(Number),
        ":status": planTypeToStatus[PlanType.Pro],
      },
      ProjectionExpression:
        "projectId, email, userId, projectName, nextPaymentDate, currentPlan, cardTokenInfo",
      Limit: batchLimit,
      ExclusiveStartKey: undefined,
    });

    expect(mockQueryCommand).toHaveBeenCalledWith({
      IndexName: "expiredSubscriptionIndex",
      TableName: process.env.TABLE_NAME!,
      KeyConditionExpression:
        "sub_status = :status AND nextPaymentDate <= :currentDate",
      ExpressionAttributeValues: {
        ":currentDate": expect.any(Number),
        ":status": planTypeToStatus[PlanType.Executive],
      },
      ProjectionExpression:
        "projectId, email, userId, projectName, nextPaymentDate, currentPlan, cardTokenInfo",
      Limit: batchLimit,
      ExclusiveStartKey: undefined,
    });

    expect(console.log).toHaveBeenCalledWith("fetching secrets");

    expect(mockGetSecretValueCommand).toHaveBeenCalledTimes(2);
    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.PAYMENT_SECRET_NAME,
    });
    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.AVAILABLE_PLANS_SECRET_NAME,
    });

    expect(mockSendMessageCommand).toHaveBeenCalledTimes(3);

    expect(mockSendMessageCommand).toHaveBeenNthCalledWith(1, {
      QueueUrl: process.env.DOWNGRADE_SUBSCRIPTION_QUEUE_URL,
      MessageBody: JSON.stringify({
        projectId: proProjectId,
        email: projectEmail,
        userId: "4d5e6f7a-8b9c-0d1e-2f3a-4b5c6d7e8f9a",
        projectName: "project-name",
        nextPaymentDate: 1,
        currentPlan: PlanType.Pro,
        cardTokenInfo: {
          cardToken: "card-token",
          cardTokenExpiryDate: "card-token-expiry-date",
        },
      }),
    });

    expect(mockSendMessageCommand).toHaveBeenNthCalledWith(2, {
      QueueUrl: process.env.DOWNGRADE_SUBSCRIPTION_QUEUE_URL,
      MessageBody: JSON.stringify({
        projectId: executiveProjectId,
        email: projectEmail,
        userId: "4d5e6f7a-8b9c-0d1e-2f3a-4b5c6d7e8f9a",
        projectName: "project-name",
        nextPaymentDate: 1,
        currentPlan: PlanType.Executive,
        cardTokenInfo: {
          cardToken: "card-token",
          cardTokenExpiryDate: "card-token-expiry-date",
        },
      }),
    });

    expect(console.error).toHaveBeenCalledTimes(4);
    expect(console.error).toHaveBeenNthCalledWith(
      1,
      "Error charging user: test@email.com",
      expect.any(Error)
    );
    expect(console.error).toHaveBeenNthCalledWith(
      2,
      "Error charging user: test@email.com",
      expect.any(Error)
    );

    expect(console.log).toHaveBeenCalledWith(
      `SENDING PROJECT WITH ID: ${proProjectId} TO DOWNGRADE QUEUE`
    );

    expect(console.log).toHaveBeenCalledWith(
      `SENDING PROJECT WITH ID: ${executiveProjectId} TO DOWNGRADE QUEUE`
    );

    expect(console.error).toHaveBeenNthCalledWith(
      3,
      "Error charging user: test@email.com",
      expect.any(Error)
    );

    expect(console.error).toHaveBeenNthCalledWith(
      4,
      "Error charging user: test@email.com",
      expect.any(Error)
    );

    expect(mockSendMessageCommand).toHaveBeenNthCalledWith(3, {
      QueueUrl: process.env.RESUBSCRIBE_QUEUE_URL,
      MessageBody: JSON.stringify({
        pro: "fake last evaluated string",
        exec: "fake last evaluated string",
      }),
    });

    expect(console.log).toHaveBeenCalledWith("completed successfully");
  });

  test("it should fail to resubscribe all users due to network error & also fail to send to downgrade queue", async () => {
    const projectEmail = "test@email.com";

    const mockQueryCommand = jest.fn().mockImplementation((params) => {
      return {
        Items: [
          {
            projectId:
              params.ExpressionAttributeValues[":status"] ===
              planTypeToStatus[PlanType.Pro]
                ? proProjectId
                : executiveProjectId,
            email: projectEmail,
            userId: "4d5e6f7a-8b9c-0d1e-2f3a-4b5c6d7e8f9a",
            projectName: "project-name",
            nextPaymentDate: 1,
            currentPlan:
              params.ExpressionAttributeValues[":status"] ===
              planTypeToStatus[PlanType.Pro]
                ? PlanType.Pro
                : PlanType.Executive,
            cardTokenInfo: {
              cardToken: "card-token",
              cardTokenExpiryDate: "card-token-expiry-date",
            },
          },
        ],
        LastEvaluatedKey: "fake last evaluated string",
      };
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
        QueryCommand: mockQueryCommand,
      };
    });

    const mockGetSecretValueCommand = jest.fn().mockImplementation((params) => {
      if (params.SecretId === process.env.PAYMENT_SECRET_NAME) {
        return {
          SecretString: "payment-secret",
        };
      }

      if (params.SecretId === process.env.AVAILABLE_PLANS_SECRET_NAME) {
        return {
          SecretString: JSON.stringify({
            executive: "executive",
            pro: "pro",
            free: "free",
          }),
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
                amount: 1000,
                currency: "NGN",
              },
              {
                id: "2",
                name: "Executive",
                amount: 2000,
                currency: "NGN",
              },
            ],
          }),
        };
      }

      if (input === `${process.env.PAYMENT_GATEWAY_URL}/tokenized-charges`) {
        return {
          ok: false,
          status: 500,
          json: jest.fn().mockResolvedValue({
            message: "failed to charge user",
          }),
        };
      }

      throw new Error("failed to fetch plans from payment gateway");
    });

    const mockSendMessageCommand = jest.fn().mockImplementation((params) => {
      if (params.QueueUrl === process.env.DOWNGRADE_SUBSCRIPTION_QUEUE_URL) {
        return Promise.reject(new Error("rejected"));
      }

      if (params.QueueUrl === process.env.RESUBSCRIBE_QUEUE_URL) {
        return {
          QueueUrl: params.QueueUrl,
          MessageBody: params.MessageBody,
        };
      }

      throw new Error("Queue not found");
    });

    jest.mock("@aws-sdk/client-sqs", () => {
      return {
        SQSClient: jest.fn().mockImplementation(() => ({
          send: jest.fn().mockImplementation((command) => {
            return command;
          }),
        })),
        SendMessageCommand: mockSendMessageCommand,
      };
    });

    const { handler } = await import("../../lambda-handlers/resubscribe");

    await handler();

    expect(console.log).toHaveBeenCalledWith("event", undefined);

    expect(console.log).toHaveBeenCalledWith("STARTING CURSORS", undefined);

    expect(mockQueryCommand).toHaveBeenCalledTimes(2);
    expect(mockQueryCommand).toHaveBeenCalledWith({
      IndexName: "expiredSubscriptionIndex",
      TableName: process.env.TABLE_NAME!,
      KeyConditionExpression:
        "sub_status = :status AND nextPaymentDate <= :currentDate",
      ExpressionAttributeValues: {
        ":currentDate": expect.any(Number),
        ":status": planTypeToStatus[PlanType.Pro],
      },
      ProjectionExpression:
        "projectId, email, userId, projectName, nextPaymentDate, currentPlan, cardTokenInfo",
      Limit: batchLimit,
      ExclusiveStartKey: undefined,
    });

    expect(mockQueryCommand).toHaveBeenCalledWith({
      IndexName: "expiredSubscriptionIndex",
      TableName: process.env.TABLE_NAME!,
      KeyConditionExpression:
        "sub_status = :status AND nextPaymentDate <= :currentDate",
      ExpressionAttributeValues: {
        ":currentDate": expect.any(Number),
        ":status": planTypeToStatus[PlanType.Executive],
      },
      ProjectionExpression:
        "projectId, email, userId, projectName, nextPaymentDate, currentPlan, cardTokenInfo",
      Limit: batchLimit,
      ExclusiveStartKey: undefined,
    });

    expect(console.log).toHaveBeenCalledWith("fetching secrets");

    expect(mockGetSecretValueCommand).toHaveBeenCalledTimes(2);
    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.PAYMENT_SECRET_NAME,
    });
    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.AVAILABLE_PLANS_SECRET_NAME,
    });

    expect(mockSendMessageCommand).toHaveBeenCalledTimes(3);

    expect(mockSendMessageCommand).toHaveBeenNthCalledWith(1, {
      QueueUrl: process.env.DOWNGRADE_SUBSCRIPTION_QUEUE_URL,
      MessageBody: JSON.stringify({
        projectId: proProjectId,
        email: projectEmail,
        userId: "4d5e6f7a-8b9c-0d1e-2f3a-4b5c6d7e8f9a",
        projectName: "project-name",
        nextPaymentDate: 1,
        currentPlan: PlanType.Pro,
        cardTokenInfo: {
          cardToken: "card-token",
          cardTokenExpiryDate: "card-token-expiry-date",
        },
      }),
    });

    expect(mockSendMessageCommand).toHaveBeenNthCalledWith(2, {
      QueueUrl: process.env.DOWNGRADE_SUBSCRIPTION_QUEUE_URL,
      MessageBody: JSON.stringify({
        projectId: executiveProjectId,
        email: projectEmail,
        userId: "4d5e6f7a-8b9c-0d1e-2f3a-4b5c6d7e8f9a",
        projectName: "project-name",
        nextPaymentDate: 1,
        currentPlan: PlanType.Executive,
        cardTokenInfo: {
          cardToken: "card-token",
          cardTokenExpiryDate: "card-token-expiry-date",
        },
      }),
    });

    expect(console.error).toHaveBeenCalledTimes(6);

    expect(console.error).toHaveBeenNthCalledWith(
      1,
      "Error charging user: test@email.com",
      expect.any(Error)
    );

    expect(console.error).toHaveBeenNthCalledWith(
      2,
      "Error charging user: test@email.com",
      expect.any(Error)
    );

    expect(console.log).toHaveBeenCalledWith(
      `SENDING PROJECT WITH ID: ${proProjectId} TO DOWNGRADE QUEUE`
    );

    expect(console.error).toHaveBeenNthCalledWith(
      3,
      `ERROR: Failed to send project with ID: ${proProjectId} to downgrade queue`,
      expect.any(Error)
    );

    expect(console.error).toHaveBeenNthCalledWith(
      4,
      "Error charging user: test@email.com",
      expect.any(Error)
    );

    expect(console.error).toHaveBeenNthCalledWith(
      5,
      "Error charging user: test@email.com",
      expect.any(Error)
    );

    expect(console.log).toHaveBeenCalledWith(
      `SENDING PROJECT WITH ID: ${executiveProjectId} TO DOWNGRADE QUEUE`
    );

    expect(console.error).toHaveBeenNthCalledWith(
      6,
      `ERROR: Failed to send project with ID: ${executiveProjectId} to downgrade queue`,
      expect.any(Error)
    );

    expect(mockSendMessageCommand).toHaveBeenNthCalledWith(3, {
      QueueUrl: process.env.RESUBSCRIBE_QUEUE_URL,
      MessageBody: JSON.stringify({
        pro: "fake last evaluated string",
        exec: "fake last evaluated string",
      }),
    });

    expect(console.log).toHaveBeenCalledWith("completed successfully");
  });

  test("it should fail to resubscribe all users because it failed to charge users due to payment gateway error", async () => {
    const projectEmail = "test@email.com";

    const mockQueryCommand = jest.fn().mockImplementation((params) => {
      return {
        Items: [
          {
            projectId:
              params.ExpressionAttributeValues[":status"] ===
              planTypeToStatus[PlanType.Pro]
                ? proProjectId
                : executiveProjectId,
            email: projectEmail,
            userId: "4d5e6f7a-8b9c-0d1e-2f3a-4b5c6d7e8f9a",
            projectName: "project-name",
            nextPaymentDate: 1,
            currentPlan:
              params.ExpressionAttributeValues[":status"] ===
              planTypeToStatus[PlanType.Pro]
                ? PlanType.Pro
                : PlanType.Executive,
            cardTokenInfo: {
              cardToken: "card-token",
              cardTokenExpiryDate: "card-token-expiry-date",
            },
          },
        ],
        LastEvaluatedKey: "fake last evaluated string",
      };
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
        QueryCommand: mockQueryCommand,
      };
    });

    const mockGetSecretValueCommand = jest.fn().mockImplementation((params) => {
      if (params.SecretId === process.env.PAYMENT_SECRET_NAME) {
        return {
          SecretString: "payment-secret",
        };
      }

      if (params.SecretId === process.env.AVAILABLE_PLANS_SECRET_NAME) {
        return {
          SecretString: JSON.stringify({
            executive: "executive",
            pro: "pro",
            free: "free",
          }),
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
                amount: 1000,
                currency: "NGN",
              },
              {
                id: "2",
                name: "Executive",
                amount: 2000,
                currency: "NGN",
              },
            ],
          }),
        };
      }

      if (input === `${process.env.PAYMENT_GATEWAY_URL}/tokenized-charges`) {
        return {
          ok: false,
          status: 400,
          json: jest.fn().mockResolvedValue({
            message: "failed to charge user",
          }),
        };
      }

      throw new Error("failed to fetch plans from payment gateway");
    });

    const mockSendMessageCommand = jest.fn();

    jest.mock("@aws-sdk/client-sqs", () => {
      return {
        SQSClient: jest.fn().mockImplementation(() => ({
          send: jest.fn().mockImplementation((command) => {
            return Promise.resolve(command);
          }),
        })),
        SendMessageCommand: mockSendMessageCommand,
      };
    });

    const { handler } = await import("../../lambda-handlers/resubscribe");

    await handler();

    expect(console.log).toHaveBeenCalledWith("event", undefined);

    expect(console.log).toHaveBeenCalledWith("STARTING CURSORS", undefined);

    expect(mockQueryCommand).toHaveBeenCalledTimes(2);
    expect(mockQueryCommand).toHaveBeenCalledWith({
      IndexName: "expiredSubscriptionIndex",
      TableName: process.env.TABLE_NAME!,
      KeyConditionExpression:
        "sub_status = :status AND nextPaymentDate <= :currentDate",
      ExpressionAttributeValues: {
        ":currentDate": expect.any(Number),
        ":status": planTypeToStatus[PlanType.Pro],
      },
      ProjectionExpression:
        "projectId, email, userId, projectName, nextPaymentDate, currentPlan, cardTokenInfo",
      Limit: batchLimit,
      ExclusiveStartKey: undefined,
    });

    expect(mockQueryCommand).toHaveBeenCalledWith({
      IndexName: "expiredSubscriptionIndex",
      TableName: process.env.TABLE_NAME!,
      KeyConditionExpression:
        "sub_status = :status AND nextPaymentDate <= :currentDate",
      ExpressionAttributeValues: {
        ":currentDate": expect.any(Number),
        ":status": planTypeToStatus[PlanType.Executive],
      },
      ProjectionExpression:
        "projectId, email, userId, projectName, nextPaymentDate, currentPlan, cardTokenInfo",
      Limit: batchLimit,
      ExclusiveStartKey: undefined,
    });

    expect(console.log).toHaveBeenCalledWith("fetching secrets");

    expect(mockGetSecretValueCommand).toHaveBeenCalledTimes(2);
    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.PAYMENT_SECRET_NAME,
    });
    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.AVAILABLE_PLANS_SECRET_NAME,
    });

    expect(mockSendMessageCommand).toHaveBeenCalledTimes(3);

    expect(mockSendMessageCommand).toHaveBeenNthCalledWith(1, {
      QueueUrl: process.env.DOWNGRADE_SUBSCRIPTION_QUEUE_URL,
      MessageBody: JSON.stringify({
        projectId: proProjectId,
        email: projectEmail,
        userId: "4d5e6f7a-8b9c-0d1e-2f3a-4b5c6d7e8f9a",
        projectName: "project-name",
        nextPaymentDate: 1,
        currentPlan: PlanType.Pro,
        cardTokenInfo: {
          cardToken: "card-token",
          cardTokenExpiryDate: "card-token-expiry-date",
        },
      }),
    });

    expect(mockSendMessageCommand).toHaveBeenNthCalledWith(2, {
      QueueUrl: process.env.DOWNGRADE_SUBSCRIPTION_QUEUE_URL,
      MessageBody: JSON.stringify({
        projectId: executiveProjectId,
        email: projectEmail,
        userId: "4d5e6f7a-8b9c-0d1e-2f3a-4b5c6d7e8f9a",
        projectName: "project-name",
        nextPaymentDate: 1,
        currentPlan: PlanType.Executive,
        cardTokenInfo: {
          cardToken: "card-token",
          cardTokenExpiryDate: "card-token-expiry-date",
        },
      }),
    });

    expect(console.error).toHaveBeenCalledTimes(0);

    expect(console.log).toHaveBeenCalledWith(
      `SENDING PROJECT WITH ID: ${proProjectId} TO DOWNGRADE QUEUE`
    );

    expect(mockSendMessageCommand).toHaveBeenNthCalledWith(3, {
      QueueUrl: process.env.RESUBSCRIBE_QUEUE_URL,
      MessageBody: JSON.stringify({
        pro: "fake last evaluated string",
        exec: "fake last evaluated string",
      }),
    });

    expect(console.log).toHaveBeenCalledWith("completed successfully");
  });

  test("it should fail to resubscribe all users because it failed to charge users due to payment gateway error", async () => {
    const projectEmail = "test@email.com";

    const mockQueryCommand = jest.fn().mockImplementation((params) => {
      return {
        Items: [
          {
            projectId:
              params.ExpressionAttributeValues[":status"] ===
              planTypeToStatus[PlanType.Pro]
                ? proProjectId
                : executiveProjectId,
            email: projectEmail,
            userId: "4d5e6f7a-8b9c-0d1e-2f3a-4b5c6d7e8f9a",
            projectName: "project-name",
            nextPaymentDate: 1,
            currentPlan:
              params.ExpressionAttributeValues[":status"] ===
              planTypeToStatus[PlanType.Pro]
                ? PlanType.Pro
                : PlanType.Executive,
            cardTokenInfo: {
              cardToken: "card-token",
              cardTokenExpiryDate: "card-token-expiry-date",
            },
          },
        ],
        LastEvaluatedKey: "fake last evaluated string",
      };
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
        QueryCommand: mockQueryCommand,
      };
    });

    const mockGetSecretValueCommand = jest.fn().mockImplementation((params) => {
      if (params.SecretId === process.env.PAYMENT_SECRET_NAME) {
        return {
          SecretString: "payment-secret",
        };
      }

      if (params.SecretId === process.env.AVAILABLE_PLANS_SECRET_NAME) {
        return {
          SecretString: JSON.stringify({
            executive: "executive",
            pro: "pro",
            free: "free",
          }),
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
                amount: 1000,
                currency: "NGN",
              },
              {
                id: "2",
                name: "Executive",
                amount: 2000,
                currency: "NGN",
              },
            ],
          }),
        };
      }

      if (input === `${process.env.PAYMENT_GATEWAY_URL}/tokenized-charges`) {
        return {
          ok: false,
          status: 400,
          json: jest.fn().mockResolvedValue({
            message: "failed to charge user",
          }),
        };
      }

      throw new Error("failed to fetch plans from payment gateway");
    });

    const mockSendMessageCommand = jest.fn().mockImplementation((params) => {
      if (params.QueueUrl === process.env.DOWNGRADE_SUBSCRIPTION_QUEUE_URL) {
        return Promise.reject(new Error("rejected"));
      }

      if (params.QueueUrl === process.env.RESUBSCRIBE_QUEUE_URL) {
        return {
          QueueUrl: params.QueueUrl,
          MessageBody: params.MessageBody,
        };
      }

      throw new Error("Queue not found");
    });

    jest.mock("@aws-sdk/client-sqs", () => {
      return {
        SQSClient: jest.fn().mockImplementation(() => ({
          send: jest.fn().mockImplementation((command) => {
            return Promise.resolve(command);
          }),
        })),
        SendMessageCommand: mockSendMessageCommand,
      };
    });

    const { handler } = await import("../../lambda-handlers/resubscribe");

    await handler();

    expect(console.log).toHaveBeenCalledWith("event", undefined);

    expect(console.log).toHaveBeenCalledWith("STARTING CURSORS", undefined);

    expect(mockQueryCommand).toHaveBeenCalledTimes(2);
    expect(mockQueryCommand).toHaveBeenCalledWith({
      IndexName: "expiredSubscriptionIndex",
      TableName: process.env.TABLE_NAME!,
      KeyConditionExpression:
        "sub_status = :status AND nextPaymentDate <= :currentDate",
      ExpressionAttributeValues: {
        ":currentDate": expect.any(Number),
        ":status": planTypeToStatus[PlanType.Pro],
      },
      ProjectionExpression:
        "projectId, email, userId, projectName, nextPaymentDate, currentPlan, cardTokenInfo",
      Limit: batchLimit,
      ExclusiveStartKey: undefined,
    });

    expect(mockQueryCommand).toHaveBeenCalledWith({
      IndexName: "expiredSubscriptionIndex",
      TableName: process.env.TABLE_NAME!,
      KeyConditionExpression:
        "sub_status = :status AND nextPaymentDate <= :currentDate",
      ExpressionAttributeValues: {
        ":currentDate": expect.any(Number),
        ":status": planTypeToStatus[PlanType.Executive],
      },
      ProjectionExpression:
        "projectId, email, userId, projectName, nextPaymentDate, currentPlan, cardTokenInfo",
      Limit: batchLimit,
      ExclusiveStartKey: undefined,
    });

    expect(console.log).toHaveBeenCalledWith("fetching secrets");

    expect(mockGetSecretValueCommand).toHaveBeenCalledTimes(2);
    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.PAYMENT_SECRET_NAME,
    });
    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.AVAILABLE_PLANS_SECRET_NAME,
    });

    expect(mockSendMessageCommand).toHaveBeenCalledTimes(3);
    expect(console.error).toHaveBeenCalledTimes(2);

    expect(console.log).toHaveBeenCalledWith(
      `SENDING PROJECT WITH ID: ${proProjectId} TO DOWNGRADE QUEUE`
    );

    expect(mockSendMessageCommand).toHaveBeenNthCalledWith(1, {
      QueueUrl: process.env.DOWNGRADE_SUBSCRIPTION_QUEUE_URL,
      MessageBody: JSON.stringify({
        projectId: proProjectId,
        email: projectEmail,
        userId: "4d5e6f7a-8b9c-0d1e-2f3a-4b5c6d7e8f9a",
        projectName: "project-name",
        nextPaymentDate: 1,
        currentPlan: PlanType.Pro,
        cardTokenInfo: {
          cardToken: "card-token",
          cardTokenExpiryDate: "card-token-expiry-date",
        },
      }),
    });

    expect(console.error).toHaveBeenNthCalledWith(
      1,
      `ERROR: Failed to send project with ID: ${proProjectId} to downgrade queue`,
      expect.any(Error)
    );

    expect(mockSendMessageCommand).toHaveBeenNthCalledWith(2, {
      QueueUrl: process.env.DOWNGRADE_SUBSCRIPTION_QUEUE_URL,
      MessageBody: JSON.stringify({
        projectId: executiveProjectId,
        email: projectEmail,
        userId: "4d5e6f7a-8b9c-0d1e-2f3a-4b5c6d7e8f9a",
        projectName: "project-name",
        nextPaymentDate: 1,
        currentPlan: PlanType.Executive,
        cardTokenInfo: {
          cardToken: "card-token",
          cardTokenExpiryDate: "card-token-expiry-date",
        },
      }),
    });

    expect(console.error).toHaveBeenNthCalledWith(
      2,
      `ERROR: Failed to send project with ID: ${executiveProjectId} to downgrade queue`,
      expect.any(Error)
    );

    expect(mockSendMessageCommand).toHaveBeenNthCalledWith(3, {
      QueueUrl: process.env.RESUBSCRIBE_QUEUE_URL,
      MessageBody: JSON.stringify({
        pro: "fake last evaluated string",
        exec: "fake last evaluated string",
      }),
    });

    expect(console.log).toHaveBeenCalledWith("completed successfully");
  });

  test("it should throw an error because the secret string for available plans is null", async () => {
    const projectEmail = "test@email.com";

    const mockQueryCommand = jest.fn().mockImplementation((params) => {
      return {
        Items: [
          {
            projectId:
              params.ExpressionAttributeValues[":status"] ===
              planTypeToStatus[PlanType.Pro]
                ? proProjectId
                : executiveProjectId,
            email: projectEmail,
            userId: "4d5e6f7a-8b9c-0d1e-2f3a-4b5c6d7e8f9a",
            projectName: "project-name",
            nextPaymentDate: 1,
            currentPlan:
              params.ExpressionAttributeValues[":status"] ===
              planTypeToStatus[PlanType.Pro]
                ? PlanType.Pro
                : PlanType.Executive,
            cardTokenInfo: {
              cardToken: "card-token",
              cardTokenExpiryDate: "card-token-expiry-date",
            },
          },
        ],
        LastEvaluatedKey: "fake last evaluated string",
      };
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
        QueryCommand: mockQueryCommand,
      };
    });

    const mockGetSecretValueCommand = jest.fn().mockImplementation((params) => {
      if (params.SecretId === process.env.PAYMENT_SECRET_NAME) {
        return {
          SecretString: "payment-secret",
        };
      }

      if (params.SecretId === process.env.AVAILABLE_PLANS_SECRET_NAME) {
        return {
          SecretString: null,
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

    const { handler } = await import("../../lambda-handlers/resubscribe");

    await expect(handler()).rejects.toThrow(Error);

    expect(console.log).toHaveBeenCalledWith("event", undefined);

    expect(console.log).toHaveBeenCalledWith("STARTING CURSORS", undefined);

    expect(mockQueryCommand).toHaveBeenCalledTimes(2);
    expect(mockQueryCommand).toHaveBeenCalledWith({
      IndexName: "expiredSubscriptionIndex",
      TableName: process.env.TABLE_NAME!,
      KeyConditionExpression:
        "sub_status = :status AND nextPaymentDate <= :currentDate",
      ExpressionAttributeValues: {
        ":currentDate": expect.any(Number),
        ":status": planTypeToStatus[PlanType.Pro],
      },
      ProjectionExpression:
        "projectId, email, userId, projectName, nextPaymentDate, currentPlan, cardTokenInfo",
      Limit: batchLimit,
      ExclusiveStartKey: undefined,
    });

    expect(mockQueryCommand).toHaveBeenCalledWith({
      IndexName: "expiredSubscriptionIndex",
      TableName: process.env.TABLE_NAME!,
      KeyConditionExpression:
        "sub_status = :status AND nextPaymentDate <= :currentDate",
      ExpressionAttributeValues: {
        ":currentDate": expect.any(Number),
        ":status": planTypeToStatus[PlanType.Executive],
      },
      ProjectionExpression:
        "projectId, email, userId, projectName, nextPaymentDate, currentPlan, cardTokenInfo",
      Limit: batchLimit,
      ExclusiveStartKey: undefined,
    });

    expect(console.log).toHaveBeenCalledWith("fetching secrets");

    expect(mockGetSecretValueCommand).toHaveBeenCalledTimes(2);
    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.PAYMENT_SECRET_NAME,
    });
    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.AVAILABLE_PLANS_SECRET_NAME,
    });

    expect(console.error).toHaveBeenCalledWith(
      "ERROR: FAILED TO HANDLE RESUBSCRIBTION PROCESS",
      expect.any(Error)
    );
  });

  test("it should throw an error because the usage plans gotten from secret was incorrect", async () => {
    const projectEmail = "test@email.com";

    const mockQueryCommand = jest.fn().mockImplementation((params) => {
      return {
        Items: [
          {
            projectId:
              params.ExpressionAttributeValues[":status"] ===
              planTypeToStatus[PlanType.Pro]
                ? proProjectId
                : executiveProjectId,
            email: projectEmail,
            userId: "4d5e6f7a-8b9c-0d1e-2f3a-4b5c6d7e8f9a",
            projectName: "project-name",
            nextPaymentDate: 1,
            currentPlan:
              params.ExpressionAttributeValues[":status"] ===
              planTypeToStatus[PlanType.Pro]
                ? PlanType.Pro
                : PlanType.Executive,
            cardTokenInfo: {
              cardToken: "card-token",
              cardTokenExpiryDate: "card-token-expiry-date",
            },
          },
        ],
        LastEvaluatedKey: "fake last evaluated string",
      };
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
        QueryCommand: mockQueryCommand,
      };
    });

    const mockGetSecretValueCommand = jest.fn().mockImplementation((params) => {
      if (params.SecretId === process.env.PAYMENT_SECRET_NAME) {
        return {
          SecretString: "payment-secret",
        };
      }

      if (params.SecretId === process.env.AVAILABLE_PLANS_SECRET_NAME) {
        return {
          SecretString: JSON.stringify({
            pro: "pro",
            free: "free",
          }),
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

    const { handler } = await import("../../lambda-handlers/resubscribe");

    await expect(handler()).rejects.toThrow(Error);

    expect(console.log).toHaveBeenCalledWith("event", undefined);

    expect(console.log).toHaveBeenCalledWith("STARTING CURSORS", undefined);

    expect(mockQueryCommand).toHaveBeenCalledTimes(2);
    expect(mockQueryCommand).toHaveBeenCalledWith({
      IndexName: "expiredSubscriptionIndex",
      TableName: process.env.TABLE_NAME!,
      KeyConditionExpression:
        "sub_status = :status AND nextPaymentDate <= :currentDate",
      ExpressionAttributeValues: {
        ":currentDate": expect.any(Number),
        ":status": planTypeToStatus[PlanType.Pro],
      },
      ProjectionExpression:
        "projectId, email, userId, projectName, nextPaymentDate, currentPlan, cardTokenInfo",
      Limit: batchLimit,
      ExclusiveStartKey: undefined,
    });

    expect(mockQueryCommand).toHaveBeenCalledWith({
      IndexName: "expiredSubscriptionIndex",
      TableName: process.env.TABLE_NAME!,
      KeyConditionExpression:
        "sub_status = :status AND nextPaymentDate <= :currentDate",
      ExpressionAttributeValues: {
        ":currentDate": expect.any(Number),
        ":status": planTypeToStatus[PlanType.Executive],
      },
      ProjectionExpression:
        "projectId, email, userId, projectName, nextPaymentDate, currentPlan, cardTokenInfo",
      Limit: batchLimit,
      ExclusiveStartKey: undefined,
    });

    expect(console.log).toHaveBeenCalledWith("fetching secrets");

    expect(mockGetSecretValueCommand).toHaveBeenCalledTimes(2);
    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.PAYMENT_SECRET_NAME,
    });
    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: process.env.AVAILABLE_PLANS_SECRET_NAME,
    });

    expect(console.error).toHaveBeenCalledWith(
      "ERROR: FAILED TO HANDLE RESUBSCRIBTION PROCESS",
      expect.any(Error)
    );
  });
});
