import { SQSEvent } from "aws-lambda";
import {
  PlanType,
  PROJECT_STATUS,
  maxActiveFreeProjects,
} from "../../helpers/constants";
import {
  NotFoundException,
  GetUsagePlanKeyCommand,
} from "@aws-sdk/client-api-gateway";

console.log = jest.fn();
console.error = jest.fn();

const mockUsageSecret = JSON.stringify({
  free: "free",
  pro: "pro",
  executive: "executive",
});

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

  //this checks for the normal flow, a project to be downgraded is sent to the queue,
  //its still attached to its old usage plan & not attached to the new usage plan ( free plan)
  //so obviously it should still be attached to the old usage plan but not be attached to the new plan
  //the user has also not reached max free projects
  test("it should downgrade the apikey to free plan", async () => {
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

    //max free plans not reached
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

    jest.mock("@aws-sdk/lib-dynamodb", () => {
      return {
        DynamoDBDocumentClient: {
          from: jest.fn().mockImplementation(() => ({
            send: jest
              .fn()
              .mockImplementation((command) => Promise.resolve(command)),
          })),
        },
        GetCommand: mockGetCommand,
        QueryCommand: mockQueryCommand,
        UpdateCommand: mockUpdateDynamo,
      };
    });

    const mockUpdateApiKeyCommand = jest.fn();
    const mockGetUsagePlanKeyCommand = jest.fn().mockImplementation((args) => {
      //when checking if it is still attach to the old usage plan let it be true
      if (args.usagePlanId === fakeFoundProject.apiKeyInfo.usagePlanId) {
        return Promise.resolve({
          Item: {
            apiKeyId: fakeFoundProject.apiKeyInfo.apiKeyId,
            usagePlanId: JSON.parse(mockUsageSecret).free,
          },
        });
      }

      //when checking if it has been added to the new usage plan (let it be false)
      if (args.usagePlanId === JSON.parse(mockUsageSecret).free) {
        const error = new NotFoundException({
          $metadata: {
            httpStatusCode: 404,
          },
          message: "Apikey not attached",
        });

        throw error;
      }

      return Promise.resolve();
    });
    const mockCreateUsagePlanKeyCommand = jest.fn();
    const mockDeleteUsagePlanKeyCommand = jest.fn();

    jest.mock("@aws-sdk/client-api-gateway", () => {
      return {
        APIGatewayClient: jest.fn().mockImplementation(() => ({
          send: jest.fn(),
        })),
        NotFoundException: NotFoundException, //use the atcual implementation of the error
        UpdateApiKeyCommand: mockUpdateApiKeyCommand,
        GetUsagePlanKeyCommand: mockGetUsagePlanKeyCommand,
        CreateUsagePlanKeyCommand: mockCreateUsagePlanKeyCommand,
        DeleteUsagePlanKeyCommand: mockDeleteUsagePlanKeyCommand,
      };
    });

    const { handler } = await import(
      "../../lambda-handlers/downgrade-subscription-handler"
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

    //the first call for checking if the users apikey is still attached to old plan
    expect(mockGetUsagePlanKeyCommand).toHaveBeenNthCalledWith(1, {
      keyId: fakeFoundProject.apiKeyInfo.apiKeyId,
      usagePlanId: fakeFoundProject.apiKeyInfo.usagePlanId,
    });

    //the second call for checking if the users apikey is already attached to new plan
    expect(mockGetUsagePlanKeyCommand).toHaveBeenNthCalledWith(2, {
      keyId: fakeFoundProject.apiKeyInfo.apiKeyId,
      usagePlanId: JSON.parse(mockUsageSecret).free,
    });

    //it should call getUsagePlanKeyCommand twice, one for checking if its attached to old plan & one for checking if its attached to new plan
    expect(mockGetUsagePlanKeyCommand).toHaveBeenCalledTimes(2);

    //it should call the deleteUsagePlanKeyCommand once for removing the apikey from the old plan
    expect(mockDeleteUsagePlanKeyCommand).toHaveBeenCalledTimes(1);

    //it should have added the users apikey to the free usage plan
    expect(mockCreateUsagePlanKeyCommand).toHaveBeenCalledTimes(1);
    expect(mockCreateUsagePlanKeyCommand).toHaveBeenCalledWith({
      keyType: "API_KEY",
      usagePlanId: JSON.parse(mockUsageSecret).free,
      keyId: fakeFoundProject.apiKeyInfo.apiKeyId,
    });

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

  //this tests a situation where after successfully removing the apikey from old plan, something happended
  //and the entire process had to be repeated again,
  //when the process runs again, it should not try to remove from old plan
  //and should only attach to the new plan
  test("it should downgrade the apikey to free plan", async () => {
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

    jest.mock("@aws-sdk/lib-dynamodb", () => {
      return {
        DynamoDBDocumentClient: {
          from: jest.fn().mockImplementation(() => ({
            send: jest
              .fn()
              .mockImplementation((command) => Promise.resolve(command)),
          })),
        },
        GetCommand: mockGetCommand,
        QueryCommand: mockQueryCommand,
        UpdateCommand: mockUpdateDynamo,
      };
    });

    //should throw a notFoundException that the api key was not found, insinuating
    //that the apiKey has been removed from the oldPlan (when it reaches removeFromOldPlan)
    //and that the apiKey has not been attached to the new plan (when it reaches attachedToNewPlan of migrateExistingProjectApiKey)

    const mockGetUsagePlanKeyCommand = jest.fn().mockImplementation((args) => {
      //when checking if it is still attach to the old usage plan let it be true
      if (args.usagePlanId === fakeFoundProject.apiKeyInfo.usagePlanId) {
        const error = new NotFoundException({
          $metadata: {
            httpStatusCode: 404,
          },
          message: "Apikey not attached to old plans",
        });

        throw error;
      }

      //when checking if it has been added to the new usage plan (let it be false)
      if (args.usagePlanId === JSON.parse(mockUsageSecret).free) {
        const error = new NotFoundException({
          $metadata: {
            httpStatusCode: 404,
          },
          message: "Apikey not attached to new plan",
        });

        throw error;
      }

      return Promise.resolve();
    });

    const mockCreateUsagePlanKeyCommand = jest.fn();
    const mockDeleteUsagePlanKeyCommand = jest.fn();
    const mockUpdateApiKeyCommand = jest.fn();

    jest.mock("@aws-sdk/client-api-gateway", () => {
      return {
        APIGatewayClient: jest.fn().mockImplementation(() => ({
          send: jest.fn().mockImplementation((command) => {
            if (command instanceof GetUsagePlanKeyCommand) {
              return mockGetUsagePlanKeyCommand();
            }
            return command;
          }),
        })),
        UpdateApiKeyCommand: mockUpdateApiKeyCommand,
        GetUsagePlanKeyCommand: mockGetUsagePlanKeyCommand,
        CreateUsagePlanKeyCommand: mockCreateUsagePlanKeyCommand,
        DeleteUsagePlanKeyCommand: mockDeleteUsagePlanKeyCommand,
        NotFoundException, //use the real implementation
      };
    });

    const { handler } = await import(
      "../../lambda-handlers/downgrade-subscription-handler"
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

    expect(mockGetCommand).toHaveBeenCalledTimes(1);
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

    expect(mockGetUsagePlanKeyCommand).toHaveBeenCalledTimes(2);

    //first is to check if its still attached to old plan
    expect(mockGetUsagePlanKeyCommand).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        keyId: fakeFoundProject.apiKeyInfo.apiKeyId,
        usagePlanId: fakeFoundProject.apiKeyInfo.usagePlanId,
      })
    );

    //its not attached to old plan so delete should not be called
    expect(mockDeleteUsagePlanKeyCommand).toHaveBeenCalledTimes(0);

    //second is to check if its attached to free plan
    expect(mockGetUsagePlanKeyCommand).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        keyId: fakeFoundProject.apiKeyInfo.apiKeyId,
        usagePlanId: JSON.parse(mockUsageSecret).free,
      })
    );

    //its not attached to new plan, so create should be called
    expect(mockCreateUsagePlanKeyCommand).toHaveBeenCalledTimes(1);
    expect(mockCreateUsagePlanKeyCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        keyId: fakeFoundProject.apiKeyInfo.apiKeyId,
        usagePlanId: JSON.parse(mockUsageSecret).free,
        keyType: "API_KEY",
      })
    );

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

    jest.mock("@aws-sdk/lib-dynamodb", () => {
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

    const mockUpdateApiKeyCommand = jest.fn();

    jest.mock("@aws-sdk/client-api-gateway", () => {
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
      "../../lambda-handlers/downgrade-subscription-handler"
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

    jest.mock("@aws-sdk/lib-dynamodb", () => {
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

    jest.mock("@aws-sdk/client-secrets-manager", () => {
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

    const mockUpdateApiKeyCommand = jest.fn();

    jest.mock("@aws-sdk/client-api-gateway", () => {
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
      "../../lambda-handlers/downgrade-subscription-handler"
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
    jest.mock("@aws-sdk/lib-dynamodb", () => {
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

    jest.mock("@aws-sdk/client-api-gateway", () => {
      return {
        APIGatewayClient: jest.fn().mockImplementation(() => ({
          send: jest.fn(),
        })),
        NotFoundException: jest.fn(),
        UpdateApiKeyCommand: jest.fn(),
        GetUsagePlanKeyCommand: jest.fn(),
        CreateUsagePlanKeyCommand: jest.fn(),
        DeleteUsagePlanKeyCommand: jest.fn(),
      };
    });

    const { handler } = await import(
      "../../lambda-handlers/downgrade-subscription-handler"
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
    jest.mock("@aws-sdk/lib-dynamodb", () => {
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

    jest.mock("@aws-sdk/client-api-gateway", () => {
      return {
        APIGatewayClient: jest.fn().mockImplementation(() => ({
          send: jest.fn(),
        })),
        NotFoundException: jest.fn(),
        UpdateApiKeyCommand: jest.fn(),
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
      "../../lambda-handlers/downgrade-subscription-handler"
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
    jest.mock("@aws-sdk/lib-dynamodb", () => {
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

    jest.mock("@aws-sdk/client-api-gateway", () => {
      return {
        APIGatewayClient: jest.fn().mockImplementation(() => ({
          send: jest.fn(),
        })),
        NotFoundException: jest.fn(),
        UpdateApiKeyCommand: jest.fn(),
        GetUsagePlanKeyCommand: jest.fn(),
        CreateUsagePlanKeyCommand: jest.fn(),
        DeleteUsagePlanKeyCommand: jest.fn(),
      };
    });

    const { handler } = await import(
      "../../lambda-handlers/downgrade-subscription-handler"
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
    jest.mock("@aws-sdk/lib-dynamodb", () => {
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

    jest.mock("@aws-sdk/client-secrets-manager", () => {
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

    jest.mock("@aws-sdk/client-api-gateway", () => {
      return {
        APIGatewayClient: jest.fn().mockImplementation(() => ({
          send: jest.fn(),
        })),
        NotFoundException: jest.fn(),
        UpdateApiKeyCommand: jest.fn(),
        GetUsagePlanKeyCommand: jest.fn(),
        CreateUsagePlanKeyCommand: jest.fn(),
        DeleteUsagePlanKeyCommand: jest.fn(),
      };
    });

    const { handler } = await import(
      "../../lambda-handlers/downgrade-subscription-handler"
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
