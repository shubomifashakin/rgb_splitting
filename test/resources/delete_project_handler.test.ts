import { AuthorizedApiGatewayEvent } from "../../types/AuthorizedApiGateway";

const projectId = "e7d9f390-3c4b-4d2c-97a0-bc0fa03e1f8a";
const userId = "e7d9f390-3c4b-4d2c-97a0-bc0fa05e1f8a";
const apiKey = "e7d9f390-3c4b-4d2c-97a0-bc0fa05e1f8a";

console.log = jest.fn();
console.error = jest.fn();

const mockDeleteApiKeyCommand = jest.fn();

jest.mock("@aws-sdk/client-api-gateway", () => {
  return {
    APIGatewayClient: jest.fn().mockImplementation(() => ({
      send: jest.fn(),
    })),
    DeleteApiKeyCommand: mockDeleteApiKeyCommand,
  };
});

describe("delete-project_handler", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.REGION = "fake-region";
    process.env.TABLE_NAME = "fake-table-name";
  });

  test("it should delete the project", async () => {
    const mockGetCommand = jest.fn().mockResolvedValue({
      Item: {
        apiKeyInfo: {
          apiKeyId: apiKey,
          usagePlanId: "fake-usage-plan-id",
        },
      },
    });

    const mockDeleteCommand = jest.fn();

    jest.doMock("@aws-sdk/lib-dynamodb", () => {
      return {
        DynamoDBDocumentClient: {
          from: jest.fn().mockImplementation(() => ({
            send: jest.fn().mockImplementation((command) => {
              return command;
            }),
          })),
        },
        GetCommand: mockGetCommand,
        DeleteCommand: mockDeleteCommand,
      };
    });

    const event = {
      pathParameters: {
        projectId,
      },
      requestContext: {
        authorizer: {
          principalId: userId,
        },
      },
    } as unknown as AuthorizedApiGatewayEvent;

    const { handler } = await import("../../resources/delete_project_handler");

    const res = await handler(event);

    expect(console.log).toHaveBeenCalledWith(event);
    expect(console.log).toHaveBeenCalledWith("User id -->", userId);
    expect(console.log).toHaveBeenCalledWith("Project id -->", projectId);

    expect(mockGetCommand).toHaveBeenCalledWith({
      TableName: process.env.TABLE_NAME,
      Key: {
        userId,
        projectId,
      },
      ProjectionExpression: "apiKeyInfo",
    });

    expect(mockDeleteCommand).toHaveBeenCalledWith({
      TableName: process.env.TABLE_NAME,
      Key: {
        userId,
        projectId,
      },
    });

    expect(mockDeleteApiKeyCommand).toHaveBeenCalledWith({
      apiKey,
    });

    expect(console.log).toHaveBeenLastCalledWith("completed successfully");

    expect(res).toEqual({
      statusCode: 200,
      body: JSON.stringify({ message: "Success" }),
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Api-Key",
      },
    });
  });

  test("it should not delete the project -- error 401 (no userId)", async () => {
    const event = {
      pathParameters: {
        projectId,
      },
      requestContext: {
        authorizer: {
          principalId: null, //no userId here
        },
      },
    } as unknown as AuthorizedApiGatewayEvent;

    const { handler } = await import("../../resources/delete_project_handler");

    const res = await handler(event);

    expect(console.log).toHaveBeenCalledWith(event);

    expect(res).toEqual({
      statusCode: 401,
      body: JSON.stringify({ message: "Unauthorized" }),
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Api-Key",
      },
    });
  });

  test("it should not delete the project -- error 400 (invalid uuid)", async () => {
    const event = {
      pathParameters: {
        projectId: "", //invalid uuid
      },
      requestContext: {
        authorizer: {
          principalId: userId,
        },
      },
    } as unknown as AuthorizedApiGatewayEvent;

    const { handler } = await import("../../resources/delete_project_handler");

    const res = await handler(event);

    expect(res).toEqual({
      statusCode: 400,
      body: expect.stringContaining("uuid"),
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Api-Key",
      },
    });
  });

  test("it should not delete the project -- error 404 (project not found)", async () => {
    jest.doMock("@aws-sdk/lib-dynamodb", () => {
      return {
        DynamoDBDocumentClient: {
          from: jest.fn().mockImplementation(() => ({
            send: jest.fn().mockResolvedValue({
              Item: undefined,
            }),
          })),
        },
        GetCommand: jest.fn(),
        DeleteCommand: jest.fn(),
      };
    });

    const event = {
      pathParameters: {
        projectId,
      },
      requestContext: {
        authorizer: {
          principalId: userId,
        },
      },
    } as unknown as AuthorizedApiGatewayEvent;

    const { handler } = await import("../../resources/delete_project_handler");

    const res = await handler(event);

    expect(res).toEqual({
      statusCode: 404,
      body: expect.stringContaining("Project not found"),
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Api-Key",
      },
    });
  });

  test("it should not delete the project -- error 500 (dynamo error)", async () => {
    jest.doMock("@aws-sdk/lib-dynamodb", () => {
      return {
        DynamoDBDocumentClient: {
          from: jest.fn().mockImplementation(() => ({
            send: jest.fn().mockRejectedValue(new Error("fake error")), //imocked a failed dynamo call
          })),
        },
        GetCommand: jest.fn(),
        DeleteCommand: jest.fn(),
      };
    });

    const event = {
      pathParameters: {
        projectId,
      },
      requestContext: {
        authorizer: {
          principalId: userId,
        },
      },
    } as unknown as AuthorizedApiGatewayEvent;

    const { handler } = await import("../../resources/delete_project_handler");

    await expect(handler(event)).rejects.toThrow("fake error");

    expect(console.error).toHaveBeenCalledWith(
      "Failed to delete project",
      expect.any(Error)
    );
    expect(console.error).toHaveBeenCalledWith("User id:", userId);

    expect(console.error).toHaveBeenCalledTimes(2);
  });
});
