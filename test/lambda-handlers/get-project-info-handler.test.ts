import { AuthorizedApiGatewayEvent } from "../../types/AuthorizedApiGateway";

console.log = jest.fn();
console.error = jest.fn();

const fakeUUid = "e7d9f390-3c4b-4d2c-97a0-bc0fa03e1f8a";

describe("get project info handler", () => {
  beforeEach(() => {
    jest.clearAllMocks(), jest.resetModules();

    process.env.REGION = "fake-region";
    process.env.TABLE_NAME = "fake-table";
    process.env.PROCESSED_IMAGES_TABLE_NAME = "fake-processed";
  });

  test("it should get the project info for settings", async () => {
    const projectName = "fake-project";

    const mockQueryCommand = jest.fn().mockResolvedValue({
      Items: [
        {
          projectName,
        },
      ],
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

    const fakeUserId = "1";

    const event = {
      pathParameters: {
        projectId: fakeUUid,
      },
      requestContext: {
        authorizer: {
          principalId: fakeUserId,
        },
      },
      queryStringParameters: {
        field: "settings",
      },
    } as unknown as AuthorizedApiGatewayEvent;

    const { handler } = await import(
      "../../lambda-handlers/get-project-info-handler"
    );

    const res = await handler(event);

    expect(mockQueryCommand).toHaveBeenCalledWith({
      TableName: "fake-table",
      KeyConditionExpression: "projectId = :projectId AND userId = :userId",
      ExpressionAttributeValues: {
        ":userId": fakeUserId,
        ":projectId": fakeUUid,
      },
      ProjectionExpression: "projectName",
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
        projectInfo: [{ projectName }],
      }),
    });

    expect(console.log).toHaveBeenCalledWith(event);
  });

  test("it should get the project info for apikey", async () => {
    const apiKey = "fake-api-key";

    const mockQueryCommand = jest.fn().mockResolvedValue({
      Items: [
        {
          apiKey,
        },
      ],
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

    const fakeUserId = "1";

    const event = {
      pathParameters: {
        projectId: fakeUUid,
      },
      requestContext: {
        authorizer: {
          principalId: fakeUserId,
        },
      },
      queryStringParameters: {
        field: "apikey",
      },
    } as unknown as AuthorizedApiGatewayEvent;

    const { handler } = await import(
      "../../lambda-handlers/get-project-info-handler"
    );

    const res = await handler(event);

    expect(mockQueryCommand).toHaveBeenCalledWith({
      TableName: "fake-table",
      KeyConditionExpression: "projectId = :projectId AND userId = :userId",
      ExpressionAttributeValues: {
        ":userId": fakeUserId,
        ":projectId": fakeUUid,
      },
      ProjectionExpression: "apiKey",
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
        projectInfo: [{ apiKey }],
      }),
    });

    expect(console.log).toHaveBeenCalledWith(event);
  });

  test("it should get the project info for plans", async () => {
    const plans = {
      currentPlan: "fake-plan",
      nextPaymentDate: "fake-date",
      currentBillingDate: "fake-date",
      sub_status: "fake-status",
      projectName: "fake-project",
    };

    const mockQueryCommand = jest.fn().mockResolvedValue({
      Items: [
        {
          ...plans,
        },
      ],
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

    const fakeUserId = "1";

    const event = {
      pathParameters: {
        projectId: fakeUUid,
      },
      requestContext: {
        authorizer: {
          principalId: fakeUserId,
        },
      },
      queryStringParameters: {
        field: "plans",
      },
    } as unknown as AuthorizedApiGatewayEvent;

    const { handler } = await import(
      "../../lambda-handlers/get-project-info-handler"
    );

    const res = await handler(event);

    expect(mockQueryCommand).toHaveBeenCalledWith({
      TableName: "fake-table",
      KeyConditionExpression: "projectId = :projectId AND userId = :userId",
      ExpressionAttributeValues: {
        ":userId": fakeUserId,
        ":projectId": fakeUUid,
      },
      ProjectionExpression:
        "currentPlan, nextPaymentDate, currentBillingDate, sub_status, projectName",
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
        projectInfo: [{ ...plans }],
      }),
    });

    expect(console.log).toHaveBeenCalledWith(event);
  });

  test("it should get the project info for gallery", async () => {
    const gallery = {
      currentPlan: "fake-plan",
      nextPaymentDate: "fake-date",
      currentBillingDate: "fake-date",
      sub_status: "fake-status",
      projectName: "fake-project",
    };

    const mockQueryCommand = jest.fn().mockResolvedValue({
      Items: [
        {
          ...gallery,
        },
      ],
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

    const fakeUserId = "1";

    const event = {
      pathParameters: {
        projectId: fakeUUid,
      },
      requestContext: {
        authorizer: {
          principalId: fakeUserId,
        },
      },
      queryStringParameters: {
        field: "gallery",
      },
    } as unknown as AuthorizedApiGatewayEvent;

    const { handler } = await import(
      "../../lambda-handlers/get-project-info-handler"
    );

    const res = await handler(event);

    expect(mockQueryCommand).toHaveBeenCalledWith({
      TableName: "fake-processed",
      KeyConditionExpression: "projectId = :projectId",
      ExpressionAttributeValues: {
        ":userId": fakeUserId,
        ":projectId": fakeUUid,
      },
      ProjectionExpression: "originalImageUrl, createdAt, imageId",
      Limit: 12,
      ScanIndexForward: false,
      ExclusiveStartKey: undefined,
      FilterExpression: "userId = :userId",
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
        projectInfo: [{ ...gallery }],
        nextKey: undefined,
      }),
    });

    expect(console.log).toHaveBeenCalledWith(event);
    expect(console.log).toHaveBeenCalledWith("completed successfully");
  });

  test("it should get the project info for gallery with a start key", async () => {
    const gallery = {
      currentPlan: "fake-plan",
      nextPaymentDate: "fake-date",
      currentBillingDate: "fake-date",
      sub_status: "fake-status",
      projectName: "fake-project",
    };

    const mockQueryCommand = jest.fn().mockResolvedValue({
      Items: [
        {
          ...gallery,
        },
      ],
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

    const fakeUserId = "1";

    const event = {
      pathParameters: {
        projectId: fakeUUid,
      },
      requestContext: {
        authorizer: {
          principalId: fakeUserId,
        },
      },
      queryStringParameters: {
        field: "gallery",
        query: encodeURIComponent(
          JSON.stringify({
            projectId: "1",
          })
        ),
      },
    } as unknown as AuthorizedApiGatewayEvent;

    const { handler } = await import(
      "../../lambda-handlers/get-project-info-handler"
    );

    const res = await handler(event);

    expect(mockQueryCommand).toHaveBeenCalledWith({
      TableName: "fake-processed",
      KeyConditionExpression: "projectId = :projectId",
      ExpressionAttributeValues: {
        ":userId": fakeUserId,
        ":projectId": fakeUUid,
      },
      ProjectionExpression: "originalImageUrl, createdAt, imageId",
      Limit: 12,
      ScanIndexForward: false,
      ExclusiveStartKey: { projectId: "1" },
      FilterExpression: "userId = :userId",
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
        projectInfo: [{ ...gallery }],
        nextKey: { projectId: "1" },
      }),
    });

    expect(console.log).toHaveBeenCalledWith(event);
    expect(console.log).toHaveBeenCalledWith("completed successfully");
  });

  test("it should return a 400 error because userId was not specified", async () => {
    const event = {
      pathParameters: {
        projectId: fakeUUid,
      },
      requestContext: {
        authorizer: {
          principalId: undefined,
        },
      },
      queryStringParameters: {
        field: "gallery",
      },
    } as unknown as AuthorizedApiGatewayEvent;

    const { handler } = await import(
      "../../lambda-handlers/get-project-info-handler"
    );

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
        message: "Unauthorized",
      }),
    });

    expect(console.log).toHaveBeenCalledWith(event);
  });

  test("it should return a 400 error due to invalid projectId", async () => {
    const event = {
      pathParameters: {
        projectId: "fakeUUid", //invalid project id
      },
      requestContext: {
        authorizer: {
          principalId: fakeUUid,
        },
      },
      queryStringParameters: {
        field: "gallery",
      },
    } as unknown as AuthorizedApiGatewayEvent;

    const { handler } = await import(
      "../../lambda-handlers/get-project-info-handler"
    );

    const res = await handler(event);

    expect(console.error).toHaveBeenCalledWith(
      "Failed to validate project id",
      expect.any(Object)
    );

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

    expect(console.log).toHaveBeenCalledWith(event);
  });

  test("it should return a 400 error due to invalid searchparams", async () => {
    const event = {
      pathParameters: {
        projectId: fakeUUid,
      },
      requestContext: {
        authorizer: {
          principalId: fakeUUid,
        },
      },
      queryStringParameters: {
        field: "fake", //invalid
      },
    } as unknown as AuthorizedApiGatewayEvent;

    const { handler } = await import(
      "../../lambda-handlers/get-project-info-handler"
    );

    const res = await handler(event);

    expect(console.error).toHaveBeenCalledWith(
      "Failed to validate project id",
      expect.any(Object)
    );

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

    expect(console.log).toHaveBeenCalledWith(event);
  });

  test("it should return a 404 error because project info for plans was not found", async () => {
    const plans = {
      currentPlan: "fake-plan",
      nextPaymentDate: "fake-date",
      currentBillingDate: "fake-date",
      sub_status: "fake-status",
      projectName: "fake-project",
    };

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

    const fakeUserId = "1";

    const event = {
      pathParameters: {
        projectId: fakeUUid,
      },
      requestContext: {
        authorizer: {
          principalId: fakeUserId,
        },
      },
      queryStringParameters: {
        field: "plans",
      },
    } as unknown as AuthorizedApiGatewayEvent;

    const { handler } = await import(
      "../../lambda-handlers/get-project-info-handler"
    );

    const res = await handler(event);

    expect(mockQueryCommand).toHaveBeenCalledWith({
      TableName: "fake-table",
      KeyConditionExpression: "projectId = :projectId AND userId = :userId",
      ExpressionAttributeValues: {
        ":userId": fakeUserId,
        ":projectId": fakeUUid,
      },
      ProjectionExpression:
        "currentPlan, nextPaymentDate, currentBillingDate, sub_status, projectName",
    });

    expect(res).toEqual({
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Api-Key",
      },
      statusCode: 404,
      body: JSON.stringify({
        message: "Project not found",
      }),
    });

    expect(console.error).toHaveBeenCalledTimes(0);

    expect(console.log).toHaveBeenCalledWith(event);
  });

  test("it should throw an error because project info Items for gallery was undefined", async () => {
    const mockQueryCommand = jest.fn().mockResolvedValue({
      Items: undefined, //Items is undefined
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

    const fakeUserId = "1";

    const event = {
      pathParameters: {
        projectId: fakeUUid,
      },
      requestContext: {
        authorizer: {
          principalId: fakeUserId,
        },
      },
      queryStringParameters: {
        field: "gallery",
      },
    } as unknown as AuthorizedApiGatewayEvent;

    const { handler } = await import(
      "../../lambda-handlers/get-project-info-handler"
    );

    await expect(handler(event)).rejects.toThrow(Error);

    expect(mockQueryCommand).toHaveBeenCalledWith({
      TableName: "fake-processed",
      KeyConditionExpression: "projectId = :projectId",
      ExpressionAttributeValues: {
        ":userId": fakeUserId,
        ":projectId": fakeUUid,
      },
      ProjectionExpression: "originalImageUrl, createdAt, imageId",
      Limit: 12,
      ScanIndexForward: false,
      ExclusiveStartKey: undefined,
      FilterExpression: "userId = :userId",
    });

    expect(console.error).toHaveBeenCalledWith(
      "Failed to get project info",
      expect.any(Object)
    );

    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.log).toHaveBeenCalledWith(event);
  });
});
