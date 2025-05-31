import { AuthorizedApiGatewayEvent } from "../../types/AuthorizedApiGateway";

const fakeUUid = "e7d9f390-3c4b-4d2c-97a0-bc0fa03e1f8a";

console.log = jest.fn();
console.error = jest.fn();

describe("get processed images web handler", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.REGION = "fake-region";
    process.env.PROCESSED_IMAGES_TABLE_NAME = "fake-table-name";
  });

  test("it should get the processed images", async () => {
    const event = {
      pathParameters: {
        imageId: fakeUUid,
        projectId: fakeUUid,
      },
      requestContext: {
        authorizer: {
          principalId: fakeUUid,
        },
      },
    } as unknown as AuthorizedApiGatewayEvent;

    const mockQueryCommand = jest.fn().mockResolvedValue({
      Items: [
        {
          createdAt: "102920",
          originalImageUrl: "https://example.com/image.jpg",
          results: {
            channels: ["red", "green", "blue"],
            grain: ["horizontal", "vertical"],
          },
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

    const { handler } = await import(
      "../../lambda-handlers/get-processed-images-web-handler"
    );

    const result = await handler(event);

    expect(mockQueryCommand).toHaveBeenCalledWith({
      TableName: process.env.PROCESSED_IMAGES_TABLE_NAME!,
      KeyConditionExpression: "imageId = :imageId AND projectId = :projectId",
      ExpressionAttributeValues: {
        ":userId": fakeUUid,
        ":imageId": fakeUUid,
        ":projectId": fakeUUid,
      },
      FilterExpression: "userId = :userId",
      Limit: 1,
      ProjectionExpression:
        "createdAt, originalImageUrl, results, imageId, projectId",
    });

    expect(console.log).toHaveBeenCalledWith(event);

    expect(result).toEqual({
      statusCode: 200,
      body: JSON.stringify({
        createdAt: "102920",
        originalImageUrl: "https://example.com/image.jpg",
        results: {
          channels: ["red", "green", "blue"],
          grain: ["horizontal", "vertical"],
        },
      }),
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Api-Key",
      },
    });
  });

  test("it should return a 400 error (no userId)", async () => {
    const event = {
      pathParameters: {
        imageId: fakeUUid,
        projectId: fakeUUid,
      },
      requestContext: {
        authorizer: {
          principalId: undefined,
        },
      },
    } as unknown as AuthorizedApiGatewayEvent;

    const { handler } = await import(
      "../../lambda-handlers/get-processed-images-web-handler"
    );

    const result = await handler(event);

    expect(console.log).toHaveBeenCalledWith(event);

    expect(result).toEqual({
      statusCode: 400,
      body: JSON.stringify({
        message: "Unauthorized",
      }),
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Api-Key",
      },
    });
  });

  test("it should return a 400 error (no pathParameters)", async () => {
    const event = {
      pathParameters: undefined,
      requestContext: {
        authorizer: {
          principalId: fakeUUid,
        },
      },
    } as unknown as AuthorizedApiGatewayEvent;

    const { handler } = await import(
      "../../lambda-handlers/get-processed-images-web-handler"
    );

    const result = await handler(event);

    expect(console.log).toHaveBeenCalledWith(event);

    expect(result).toEqual({
      statusCode: 400,
      body: JSON.stringify({
        message: "Bad Request",
      }),
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Api-Key",
      },
    });
  });

  test("it should return a 400 error (invalid pathParameters)", async () => {
    const event = {
      pathParameters: {
        imageId: "invalid-image-id",
        projectId: "invalid-project-id",
      },
      requestContext: {
        authorizer: {
          principalId: fakeUUid,
        },
      },
    } as unknown as AuthorizedApiGatewayEvent;

    const { handler } = await import(
      "../../lambda-handlers/get-processed-images-web-handler"
    );

    const result = await handler(event);

    expect(console.log).toHaveBeenCalledWith(event);
    expect(console.error).toHaveBeenCalledWith(
      "Failed to validate image key --->",
      expect.any(Object)
    );

    expect(result).toEqual({
      statusCode: 400,
      body: expect.any(String),
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Api-Key",
      },
    });
  });

  test("it should return a 404 error (project not found)", async () => {
    const event = {
      pathParameters: {
        imageId: fakeUUid,
        projectId: fakeUUid,
      },
      requestContext: {
        authorizer: {
          principalId: fakeUUid,
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
      "../../lambda-handlers/get-processed-images-web-handler"
    );

    const result = await handler(event);

    expect(console.log).toHaveBeenCalledWith(event);

    expect(result).toEqual({
      statusCode: 404,
      body: JSON.stringify({
        message: "Not found",
      }),
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Api-Key",
      },
    });
  });

  test("it should throw an error (dynamo error)", async () => {
    const event = {
      pathParameters: {
        imageId: fakeUUid,
        projectId: fakeUUid,
      },
      requestContext: {
        authorizer: {
          principalId: fakeUUid,
        },
      },
    } as unknown as AuthorizedApiGatewayEvent;

    const mockQueryCommand = jest.fn().mockRejectedValue(new Error("test"));

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
      "../../lambda-handlers/get-processed-images-web-handler"
    );

    await expect(handler(event)).rejects.toThrow(expect.any(Error));

    expect(console.log).toHaveBeenCalledWith(event);
    expect(console.error).toHaveBeenCalledWith(
      "Failed to get processed results -->",
      expect.any(Error)
    );
  });
});
