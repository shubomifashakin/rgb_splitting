import { AuthorizedApiGatewayEvent } from "../../types/AuthorizedApiGateway";

console.log = jest.fn();
console.error = jest.fn();

describe("get users projects handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    process.env.REGION = "fake-region";
    process.env.TABLE_NAME = "fake-table";
  });

  test("it should get the users project", async () => {
    const userId = "1";

    const event = {
      requestContext: {
        authorizer: {
          principalId: userId,
        },
      },
    } as unknown as AuthorizedApiGatewayEvent;

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

    const { handler } = await import(
      "../../resources/get-users-projects-handler"
    );

    const res = await handler(event);

    expect(mockQueryCommand).toHaveBeenCalledWith({
      TableName: "fake-table",
      IndexName: "userIdIndex",
      KeyConditionExpression: "userId = :userId",
      ExpressionAttributeValues: {
        ":userId": userId,
      },
      Limit: 12,
      ScanIndexForward: false,
      ExclusiveStartKey: undefined,
      ProjectionExpression: "projectId, projectName, currentPlan, sub_status",
    });

    expect(console.log).toHaveBeenCalledWith(event);
    expect(console.log).toHaveBeenCalledWith("start key --->", undefined);
    expect(console.log).toHaveBeenLastCalledWith("completed successfully");

    expect(res).toEqual({
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Api-Key",
      },
      statusCode: 200,
      body: JSON.stringify({
        projects: [],
        nextKey: undefined,
      }),
    });
  });

  test("it should get the users project with a start key", async () => {
    const userId = "1";

    const event = {
      requestContext: {
        authorizer: {
          principalId: userId,
        },
      },
      queryStringParameters: {
        query: encodeURIComponent(
          JSON.stringify({
            projectId: "1",
          })
        ),
      },
    } as unknown as AuthorizedApiGatewayEvent;

    const mockQueryCommand = jest.fn().mockResolvedValue({
      Items: [],
      LastEvaluatedKey: {
        projectId: "1",
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
        QueryCommand: mockQueryCommand,
      };
    });

    const { handler } = await import(
      "../../resources/get-users-projects-handler"
    );

    const res = await handler(event);

    expect(mockQueryCommand).toHaveBeenCalledWith({
      TableName: "fake-table",
      IndexName: "userIdIndex",
      KeyConditionExpression: "userId = :userId",
      ExpressionAttributeValues: {
        ":userId": userId,
      },
      Limit: 12,
      ScanIndexForward: false,
      ExclusiveStartKey: {
        projectId: "1",
      },
      ProjectionExpression: "projectId, projectName, currentPlan, sub_status",
    });

    expect(console.log).toHaveBeenCalledWith(event);
    expect(console.log).toHaveBeenCalledWith("start key --->", {
      projectId: "1",
    });
    expect(console.log).toHaveBeenLastCalledWith("completed successfully");

    expect(res).toEqual({
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Api-Key",
      },
      statusCode: 200,
      body: JSON.stringify({
        projects: [],
        nextKey: {
          projectId: "1",
        },
      }),
    });
  });

  test("it should return a 400 error because userId was not specified", async () => {
    const event = {
      requestContext: {
        authorizer: undefined,
      },
    } as unknown as AuthorizedApiGatewayEvent;

    const { handler } = await import(
      "../../resources/get-users-projects-handler"
    );

    const res = await handler(event);

    expect(console.log).toHaveBeenCalledWith(event);

    expect(res).toEqual({
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Api-Key",
      },
      statusCode: 400,
      body: JSON.stringify({
        message: "Unauthorized",
      }),
    });
  });

  test("it should throw an error because dynamo failed", async () => {
    const userId = "1";

    const event = {
      requestContext: {
        authorizer: {
          principalId: userId,
        },
      },
    } as unknown as AuthorizedApiGatewayEvent;

    const mockQueryCommand = jest
      .fn()
      .mockRejectedValue(new Error("failed to get users projects"));

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

    const { handler } = await import(
      "../../resources/get-users-projects-handler"
    );

    await expect(handler(event)).rejects.toThrow(Error);

    expect(mockQueryCommand).toHaveBeenCalledWith({
      TableName: "fake-table",
      IndexName: "userIdIndex",
      KeyConditionExpression: "userId = :userId",
      ExpressionAttributeValues: {
        ":userId": userId,
      },
      Limit: 12,
      ScanIndexForward: false,
      ExclusiveStartKey: undefined,
      ProjectionExpression: "projectId, projectName, currentPlan, sub_status",
    });

    expect(console.log).toHaveBeenCalledWith(event);
    expect(console.log).toHaveBeenCalledWith("start key --->", undefined);
    expect(console.error).toHaveBeenCalledWith(
      "FAILED TO GET USERS API KEYS FROM DB",
      expect.any(Error)
    );
    expect(console.error).toHaveBeenCalledTimes(1);
  });
});
