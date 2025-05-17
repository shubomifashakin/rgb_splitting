import { SQSEvent } from "aws-lambda";
import {
  maxActiveFreeProjects,
  PlanType,
  PROJECT_STATUS,
} from "../../helpers/constants";

console.log = jest.fn();
console.error = jest.fn();

const mockUsageSecret = JSON.stringify({
  free: "free",
  pro: "pro",
  executive: "executive",
});

const mockUpdateApiKeyCommand = jest.fn();
const mockGetUsagePlanKeyCommand = jest.fn();
const mockCreateUsagePlanKeyCommand = jest.fn();
const mockDeleteUsagePlanKeyCommand = jest.fn();

const mockUpdateDynamo = jest.fn();

const fakeEvent = {
  email: "fake-email",
  userId: "fake-user-id",
  projectId: "fake-project-id",
};

const fakeFoundProject = {
  apiKeyInfo: {
    apiKeyId: "fake-api-key-id",
    usagePlanId: "fake-usage-plan-id",
  },
  sub_status: PROJECT_STATUS.ActiveExecutive,
  currentPlan: PlanType.Executive,
};

describe("downgrade subscription handler", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    process.env.REGION = "fake-region";
    process.env.TABLE_NAME = "fake-table-name";
    process.env.AVAILABLE_PLANS_SECRET_NAME = "fake-secret-name";
  });

  test("it should downgrade the apikey to free plan", async () => {
    jest.doMock("@aws-sdk/client-secrets-manager", () => {
      return {
        SecretsManagerClient: jest.fn().mockImplementation(() => ({
          send: jest.fn().mockResolvedValue({
            SecretString: mockUsageSecret,
          }),
        })),
        GetSecretValueCommand: jest.fn(),
      };
    });

    const mockQueryCommand = jest.fn(() => {
      return {
        Items: [1, 2],
      };
    });

    const mockGetCommand = jest.fn(() => {
      return {
        Item: fakeFoundProject,
      };
    });

    jest.doMock("@aws-sdk/lib-dynamodb", () => {
      return {
        DynamoDBDocumentClient: {
          from: jest.fn().mockImplementation(() => ({
            send: jest
              .fn()
              .mockImplementation((command) => Promise.resolve(command)),
          })),
        },
        GetCommand: mockGetCommand,
        UpdateCommand: mockUpdateDynamo,
        QueryCommand: mockQueryCommand,
      };
    });

    jest.doMock("@aws-sdk/client-api-gateway", () => {
      return {
        APIGatewayClient: jest.fn().mockImplementation(() => ({
          send: jest.fn(),
        })),
        NotFoundException: jest.fn(),
        UpdateApiKeyCommand: mockUpdateApiKeyCommand,
        GetUsagePlanKeyCommand: mockGetUsagePlanKeyCommand,
        CreateUsagePlanKeyCommand: mockCreateUsagePlanKeyCommand,
        DeleteUsagePlanKeyCommand: mockDeleteUsagePlanKeyCommand,
      };
    });

    const { handler } = await import(
      "../../resources/downgrade-subscription-handler"
    );

    const event = {
      Records: [
        {
          body: JSON.stringify(fakeEvent),
          messageId: "fake-message-id",
        },
      ],
    };

    const res = await handler(event as unknown as SQSEvent);

    expect(mockGetCommand).toHaveBeenCalledWith({
      TableName: process.env.TABLE_NAME!,
      Key: {
        userId: fakeEvent.userId,
        projectId: fakeEvent.projectId,
      },
      ProjectionExpression: "apiKeyInfo, sub_status, currentPlan",
    });

    expect(mockQueryCommand).toHaveBeenCalledWith({
      TableName: process.env.TABLE_NAME!,
      IndexName: "userIdSubStatusIndex",
      KeyConditionExpression: "userId = :userId and sub_status = :status",
      ExpressionAttributeValues: {
        ":userId": fakeEvent.userId,
        ":status": PROJECT_STATUS.ActiveFree,
      },
      Limit: maxActiveFreeProjects,
    });

    expect(mockQueryCommand).toHaveBeenCalledTimes(1);
    expect(mockGetCommand).toHaveBeenCalledTimes(1);

    expect(mockGetUsagePlanKeyCommand).toHaveBeenCalledWith({
      keyId: fakeFoundProject.apiKeyInfo.apiKeyId,
      usagePlanId: fakeFoundProject.apiKeyInfo.usagePlanId,
    });

    //it should call getUsagePlanKeyCommand twice, one for checking if its attached to old plan & one for checking if its attached to new plan
    expect(mockGetUsagePlanKeyCommand).toHaveBeenCalledTimes(2);

    //the update command should be called with expected params
    expect(mockUpdateDynamo).toHaveBeenCalledWith({
      TableName: process.env.TABLE_NAME!,
      Key: {
        userId: fakeEvent.userId,
        projectId: fakeEvent.projectId,
      },
      UpdateExpression:
        "set apiKeyInfo.usagePlanId = :usagePlanId, currentPlan = :planName, sub_status = :subStatus",
      ExpressionAttributeValues: {
        ":planName": PlanType.Free,
        ":usagePlanId": JSON.parse(mockUsageSecret).free,
        ":subStatus": PROJECT_STATUS.ActiveFree,
      },
    });
    expect(mockUpdateDynamo).toHaveBeenCalledTimes(1);

    expect(console.log).toHaveBeenCalledWith("completed successfully");
    expect(console.error).toHaveBeenCalledTimes(0);
    expect(res).toEqual({ batchItemFailures: [] });
  });

  test("it should disable the apikey since max free project reached", async () => {
    const mockQueryCommand = jest.fn(() => {
      return {
        Items: [1, 2, 3],
      };
    });

    const mockGetCommand = jest.fn(() => {
      return {
        Item: fakeFoundProject,
      };
    });

    jest.doMock("@aws-sdk/lib-dynamodb", () => {
      return {
        DynamoDBDocumentClient: {
          from: jest.fn().mockImplementation(() => ({
            send: jest
              .fn()
              .mockImplementation((command) => Promise.resolve(command)),
          })),
        },
        GetCommand: mockGetCommand,
        UpdateCommand: mockUpdateDynamo,
        QueryCommand: mockQueryCommand,
      };
    });

    jest.doMock("@aws-sdk/client-secrets-manager", () => {
      return {
        SecretsManagerClient: jest.fn().mockImplementation(() => ({
          send: jest.fn().mockResolvedValue({
            SecretString: mockUsageSecret,
          }),
        })),
        GetSecretValueCommand: jest.fn(),
      };
    });

    jest.doMock("@aws-sdk/client-api-gateway", () => {
      return {
        APIGatewayClient: jest.fn().mockImplementation(() => ({
          send: jest.fn(),
        })),
        NotFoundException: jest.fn(),
        UpdateApiKeyCommand: mockUpdateApiKeyCommand,
        GetUsagePlanKeyCommand: jest.fn(),
        CreateUsagePlanKeyCommand: jest.fn(),
        DeleteUsagePlanKeyCommand: jest.fn(),
      };
    });

    const { handler } = await import(
      "../../resources/downgrade-subscription-handler"
    );

    const event = {
      Records: [
        {
          body: JSON.stringify(fakeEvent),
          messageId: "fake-message-id",
        },
      ],
    };

    const res = await handler(event as unknown as SQSEvent);

    expect(mockGetCommand).toHaveBeenCalledWith({
      TableName: process.env.TABLE_NAME!,
      Key: {
        userId: fakeEvent.userId,
        projectId: fakeEvent.projectId,
      },
      ProjectionExpression: "apiKeyInfo, sub_status, currentPlan",
    });

    expect(mockQueryCommand).toHaveBeenCalledWith({
      TableName: process.env.TABLE_NAME!,
      IndexName: "userIdSubStatusIndex",
      KeyConditionExpression: "userId = :userId and sub_status = :status",
      ExpressionAttributeValues: {
        ":userId": fakeEvent.userId,
        ":status": PROJECT_STATUS.ActiveFree,
      },
      Limit: maxActiveFreeProjects,
    });

    //it should cancel the apikey
    expect(mockUpdateApiKeyCommand).toHaveBeenCalledWith({
      apiKey: "fake-api-key-id",
      patchOperations: [
        {
          op: "replace",
          path: "/enabled",
          value: "false",
        },
      ],
    });
    expect(mockUpdateApiKeyCommand).toHaveBeenCalledTimes(1);

    //the update command should be called with expected params
    expect(mockUpdateDynamo).toHaveBeenCalledWith({
      TableName: process.env.TABLE_NAME!,
      Key: {
        userId: fakeEvent.userId,
        projectId: fakeEvent.projectId,
      },
      UpdateExpression:
        "set apiKeyInfo.usagePlanId = :usagePlanId, currentPlan = :planName, sub_status = :subStatus",
      ExpressionAttributeValues: {
        ":planName": fakeFoundProject.currentPlan,
        ":usagePlanId": fakeFoundProject.apiKeyInfo.usagePlanId,
        ":subStatus": PROJECT_STATUS.Inactive,
      },
    });
    expect(mockUpdateDynamo).toHaveBeenCalledTimes(1);

    //it should not log any errors
    expect(console.error).toHaveBeenCalledTimes(0);

    expect(res).toEqual({ batchItemFailures: [] });
  });

  test("it should disable the apikey due to failed fetch of total active free plans", async () => {
    const mockQueryCommand = jest.fn(() => {
      return Promise.reject(); //failed to fetch total active free plans
    });

    const mockGetCommand = jest.fn(() => {
      return {
        Item: fakeFoundProject,
      };
    });

    jest.doMock("@aws-sdk/lib-dynamodb", () => {
      return {
        DynamoDBDocumentClient: {
          from: jest.fn().mockImplementation(() => ({
            send: jest.fn().mockImplementation((command) => command),
          })),
        },
        GetCommand: mockGetCommand,
        QueryCommand: mockQueryCommand,
        UpdateCommand: mockUpdateDynamo,
      };
    });

    jest.doMock("@aws-sdk/client-secrets-manager", () => {
      return {
        SecretsManagerClient: jest.fn().mockImplementation(() => ({
          send: jest.fn(() => {
            return Promise.resolve({
              SecretString: mockUsageSecret,
            });
          }),
        })),
        GetSecretValueCommand: jest.fn(),
      };
    });

    jest.doMock("@aws-sdk/client-api-gateway", () => {
      return {
        APIGatewayClient: jest.fn().mockImplementation(() => ({
          send: jest.fn(),
        })),
        NotFoundException: jest.fn(),
        UpdateApiKeyCommand: mockUpdateApiKeyCommand,
        GetUsagePlanKeyCommand: jest.fn(),
        CreateUsagePlanKeyCommand: jest.fn(),
        DeleteUsagePlanKeyCommand: jest.fn(),
      };
    });

    const { handler } = await import(
      "../../resources/downgrade-subscription-handler"
    );

    const event = {
      Records: [
        {
          body: JSON.stringify(fakeEvent),
          messageId: "fake-message-id",
        },
      ],
    };

    const res = await handler(event as unknown as SQSEvent);

    expect(mockGetCommand).toHaveBeenCalledWith({
      TableName: process.env.TABLE_NAME!,
      Key: {
        userId: fakeEvent.userId,
        projectId: fakeEvent.projectId,
      },
      ProjectionExpression: "apiKeyInfo, sub_status, currentPlan",
    });

    expect(mockQueryCommand).toHaveBeenCalledWith({
      TableName: process.env.TABLE_NAME!,
      IndexName: "userIdSubStatusIndex",
      KeyConditionExpression: "userId = :userId and sub_status = :status",
      ExpressionAttributeValues: {
        ":userId": fakeEvent.userId,
        ":status": PROJECT_STATUS.ActiveFree,
      },
      Limit: maxActiveFreeProjects,
    });

    //it should cancel the apikey
    expect(mockUpdateApiKeyCommand).toHaveBeenCalledWith({
      apiKey: "fake-api-key-id",
      patchOperations: [
        {
          op: "replace",
          path: "/enabled",
          value: "false",
        },
      ],
    });
    expect(mockUpdateApiKeyCommand).toHaveBeenCalledTimes(1);

    //the update command should be called with expected params
    expect(mockUpdateDynamo).toHaveBeenCalledWith({
      TableName: process.env.TABLE_NAME!,
      Key: {
        userId: fakeEvent.userId,
        projectId: fakeEvent.projectId,
      },
      UpdateExpression:
        "set apiKeyInfo.usagePlanId = :usagePlanId, currentPlan = :planName, sub_status = :subStatus",
      ExpressionAttributeValues: {
        ":planName": fakeFoundProject.currentPlan,
        ":subStatus": PROJECT_STATUS.Inactive,
        ":usagePlanId": fakeFoundProject.apiKeyInfo.usagePlanId,
      },
    });
    expect(mockUpdateDynamo).toHaveBeenCalledTimes(1);

    expect(console.log).toHaveBeenCalledWith(
      "failed to get total active free plans"
    );

    //it should not log any errors
    expect(console.error).toHaveBeenCalledTimes(0);

    expect(res).toEqual({
      batchItemFailures: [],
    });
  });

  test("it should return a batchItem failure -- due to dynamo error", async () => {
    jest.doMock("@aws-sdk/lib-dynamodb", () => {
      return {
        DynamoDBDocumentClient: {
          from: jest.fn().mockImplementation(() => ({
            send: jest.fn().mockRejectedValue({ status: "rejected" }),
          })),
        },
        GetCommand: jest.fn(),
        UpdateCommand: jest.fn(),
        QueryCommand: jest.fn(),
      };
    });

    jest.doMock("@aws-sdk/client-secrets-manager", () => {
      return {
        SecretsManagerClient: jest.fn().mockImplementation(() => ({
          send: jest.fn().mockResolvedValue({
            SecretString: mockUsageSecret,
          }),
        })),
        GetSecretValueCommand: jest.fn(),
      };
    });

    jest.doMock("@aws-sdk/client-api-gateway", () => {
      return {
        APIGatewayClient: jest.fn().mockImplementation(() => ({
          send: jest.fn(),
        })),
        NotFoundException: jest.fn(),
        UpdateApiKeyCommand: mockUpdateApiKeyCommand,
        GetUsagePlanKeyCommand: jest.fn(),
        CreateUsagePlanKeyCommand: jest.fn(),
        DeleteUsagePlanKeyCommand: jest.fn(),
      };
    });

    const { handler } = await import(
      "../../resources/downgrade-subscription-handler"
    );

    const event = {
      Records: [
        {
          body: JSON.stringify(fakeEvent),
          messageId: "fake-message-id",
        },
      ],
    };

    const res = await handler(event as unknown as SQSEvent);
    expect(console.error).toHaveBeenCalledWith(
      `Error fetching project info, REASON ${expect(Object)}`
    );
    expect(console.error).toHaveBeenCalledTimes(2);

    expect(res).toEqual({
      batchItemFailures: [
        {
          itemIdentifier: "fake-message-id",
        },
      ],
    });
  });

  test("it should return a batchItem failure -- due to invalid usage plans", async () => {
    jest.doMock("@aws-sdk/lib-dynamodb", () => {
      return {
        DynamoDBDocumentClient: {
          from: jest.fn().mockImplementation(() => ({
            send: jest.fn().mockImplementation((command) => command),
          })),
        },
        GetCommand: jest.fn(() => {
          return Promise.resolve({
            Item: fakeFoundProject,
          });
        }),
        UpdateCommand: jest.fn(),
        QueryCommand: jest.fn(() => {
          return Promise.resolve({
            Items: [1, 2, 3],
          });
        }),
      };
    });

    jest.doMock("@aws-sdk/client-secrets-manager", () => {
      return {
        SecretsManagerClient: jest.fn().mockImplementation(() => ({
          send: jest.fn().mockResolvedValue({
            SecretString: mockUsageSecret,
          }),
        })),
        GetSecretValueCommand: jest.fn(),
      };
    });

    jest.doMock("@aws-sdk/client-api-gateway", () => {
      return {
        APIGatewayClient: jest.fn().mockImplementation(() => ({
          send: jest.fn(),
        })),
        NotFoundException: jest.fn(),
        UpdateApiKeyCommand: mockUpdateApiKeyCommand,
        GetUsagePlanKeyCommand: jest.fn(),
        CreateUsagePlanKeyCommand: jest.fn(),
        DeleteUsagePlanKeyCommand: jest.fn(),
      };
    });

    //mocked a failed usage plan validation
    jest.mock("../../helpers/schemaValidator/usagePlanValidator", () => {
      return {
        usagePlanValidator: {
          safeParse: jest.fn().mockReturnValue({
            success: false,
            error: {
              issues: [],
            },
            data: {},
          }),
        },
      };
    });

    const { handler } = await import(
      "../../resources/downgrade-subscription-handler"
    );

    const event = {
      Records: [
        {
          body: JSON.stringify(fakeEvent),
          messageId: "fake-message-id",
        },
      ],
    };

    const res = await handler(event as unknown as SQSEvent);

    expect(console.error).toHaveBeenCalledWith(
      "Usage plans error",
      expect.any(Array)
    );
    expect(console.error).toHaveBeenCalledTimes(2);

    expect(res).toEqual({
      batchItemFailures: [
        {
          itemIdentifier: "fake-message-id",
        },
      ],
    });
  });

  test("it should return a batchItem failure -- project was not found", async () => {
    jest.doMock("@aws-sdk/lib-dynamodb", () => {
      return {
        DynamoDBDocumentClient: {
          from: jest.fn().mockImplementation(() => ({
            send: jest
              .fn()
              .mockImplementation((command) => Promise.resolve(command)),
          })),
        },
        GetCommand: jest.fn(() => {
          return {
            Item: null, // no project found
          };
        }),
        UpdateCommand: jest.fn(),
        QueryCommand: jest.fn(() => {
          return {
            Items: [1, 2, 3], //max free projects reached
          };
        }),
      };
    });

    jest.mock("@aws-sdk/client-secrets-manager", () => {
      return {
        SecretsManagerClient: jest.fn().mockImplementation(() => ({
          send: jest.fn().mockResolvedValue({
            SecretString: mockUsageSecret,
          }),
        })),
        GetSecretValueCommand: jest.fn(),
      };
    });

    jest.doMock("@aws-sdk/client-api-gateway", () => {
      return {
        APIGatewayClient: jest.fn().mockImplementation(() => ({
          send: jest.fn(),
        })),
        NotFoundException: jest.fn(),
        UpdateApiKeyCommand: mockUpdateApiKeyCommand,
        GetUsagePlanKeyCommand: jest.fn(),
        CreateUsagePlanKeyCommand: jest.fn(),
        DeleteUsagePlanKeyCommand: jest.fn(),
      };
    });

    const { handler } = await import(
      "../../resources/downgrade-subscription-handler"
    );

    const event = {
      Records: [
        {
          body: JSON.stringify(fakeEvent),
          messageId: "fake-message-id",
        },
      ],
    };

    const res = await handler(event as unknown as SQSEvent);

    expect(console.error).toHaveBeenCalledWith(
      `Project not found for ${fakeEvent.email}, projectId ${fakeEvent.projectId}`
    );
    expect(console.error).toHaveBeenCalledTimes(2);

    expect(res).toEqual({
      batchItemFailures: [{ itemIdentifier: "fake-message-id" }],
    });
  });

  test("it should return a batchItem failure -- no secret", async () => {
    jest.doMock("@aws-sdk/lib-dynamodb", () => {
      return {
        DynamoDBDocumentClient: {
          from: jest.fn().mockImplementation(() => ({
            send: jest
              .fn()
              .mockImplementation((command) => Promise.resolve(command)),
          })),
        },
        GetCommand: jest.fn(() => {
          return {
            Item: fakeFoundProject,
          };
        }),
        UpdateCommand: jest.fn(),
        QueryCommand: jest.fn(() => {
          return {
            Items: [1, 2, 3], //max free projects reached
          };
        }),
      };
    });

    jest.doMock("@aws-sdk/client-secrets-manager", () => {
      return {
        SecretsManagerClient: jest.fn().mockImplementation(() => ({
          send: jest.fn(() => {
            return Promise.resolve({
              SecretString: undefined,
            });
          }),
        })),
        GetSecretValueCommand: jest.fn(),
      };
    });

    jest.doMock("@aws-sdk/client-api-gateway", () => {
      return {
        APIGatewayClient: jest.fn().mockImplementation(() => ({
          send: jest.fn(),
        })),
        NotFoundException: jest.fn(),
        UpdateApiKeyCommand: mockUpdateApiKeyCommand,
        GetUsagePlanKeyCommand: jest.fn(),
        CreateUsagePlanKeyCommand: jest.fn(),
        DeleteUsagePlanKeyCommand: jest.fn(),
      };
    });

    const { handler } = await import(
      "../../resources/downgrade-subscription-handler"
    );

    const event = {
      Records: [
        {
          body: JSON.stringify(fakeEvent),
          messageId: "fake-message-id",
        },
      ],
    };

    const res = await handler(event as unknown as SQSEvent);

    expect(console.error).toHaveBeenCalledWith(
      "Available usage plans secret not found, is empty"
    );

    expect(console.error).toHaveBeenCalledTimes(2);
    expect(res).toEqual({
      batchItemFailures: [{ itemIdentifier: "fake-message-id" }],
    });
  });
});
