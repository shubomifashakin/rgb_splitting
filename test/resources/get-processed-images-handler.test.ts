import { APIGatewayProxyEventV2, Callback, Context } from "aws-lambda";

console.log = jest.fn();
console.error = jest.fn();

const fakeUUid = "e7d9f390-3c4b-4d2c-97a0-bc0fa03e1f8a";

describe("get processed images handler", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.REGION = "fake-region";
    process.env.PROCESSED_IMAGES_TABLE_NAME = "fake-table-name";
  });

  test("it should get the processed images", async () => {
    const mockGetCommandCommand = jest.fn().mockResolvedValue({
      Item: {
        createdAt: "102920",
        originalImageUrl: "https://example.com/image.jpg",
        results: {
          channels: ["red", "green", "blue"],
          grain: ["horizontal", "vertical"],
        },
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
        GetCommand: mockGetCommandCommand,
      };
    });

    const event = {
      pathParameters: {
        projectId: fakeUUid,
        imageId: fakeUUid,
      },
    } as unknown as APIGatewayProxyEventV2;

    const { handler } = await import(
      "../../resources/get-processed-images-handler"
    );
    const result = await handler(
      event,
      {} as unknown as Context,
      {} as unknown as Callback
    );

    expect(mockGetCommandCommand).toHaveBeenCalledWith({
      TableName: process.env.PROCESSED_IMAGES_TABLE_NAME!,
      Key: {
        imageId: fakeUUid,
        projectId: fakeUUid,
      },
      ProjectionExpression: "createdAt, originalImageUrl, results",
    });

    expect(console.log).toHaveBeenCalledWith("image Id", fakeUUid);
    expect(console.log).toHaveBeenCalledWith("project Id", fakeUUid);

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
    });
  });

  test("it should return a 400 error due to invalid pathparameters", async () => {
    const event = {
      pathParameters: undefined,
    } as unknown as APIGatewayProxyEventV2;

    const { handler } = await import(
      "../../resources/get-processed-images-handler"
    );
    const result = await handler(
      event,
      {} as unknown as Context,
      {} as unknown as Callback
    );

    expect(result).toEqual({
      statusCode: 400,
      body: JSON.stringify({ message: "Bad Request" }),
    });
  });

  test("it should return a 400 error due to failed validation", async () => {
    const event = {
      pathParameters: {
        projectId: fakeUUid,
        imageId: "invalid-image-id",
      },
    } as unknown as APIGatewayProxyEventV2;

    const { handler } = await import(
      "../../resources/get-processed-images-handler"
    );
    const result = await handler(
      event,
      {} as unknown as Context,
      {} as unknown as Callback
    );

    expect(console.error).toHaveBeenCalledWith(
      "Failed to validate image key --->",
      expect.any(Object)
    );

    expect(result).toEqual({
      statusCode: 400,
      body: JSON.stringify({ message: "Bad Request - Invalid image key" }),
    });
  });

  test("it should return a 404 error due to image not found", async () => {
    const event = {
      pathParameters: {
        imageId: fakeUUid,
        projectId: fakeUUid,
      },
    } as unknown as APIGatewayProxyEventV2;

    const mockGetCommand = jest.fn().mockResolvedValue({
      Item: undefined,
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
      };
    });

    const { handler } = await import(
      "../../resources/get-processed-images-handler"
    );

    const result = await handler(
      event,
      {} as unknown as Context,
      {} as unknown as Callback
    );

    expect(result).toEqual({
      statusCode: 404,
      body: JSON.stringify({ message: "Image not found" }),
    });
  });

  test("it should return a 500 error due to dynamo error", async () => {
    const event = {
      pathParameters: {
        imageId: fakeUUid,
        projectId: fakeUUid,
      },
    } as unknown as APIGatewayProxyEventV2;

    const mockGetCommand = jest
      .fn()
      .mockRejectedValue(new Error("DynamoDB error"));

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
      };
    });

    const { handler } = await import(
      "../../resources/get-processed-images-handler"
    );

    await expect(
      handler(event, {} as unknown as Context, {} as unknown as Callback)
    ).rejects.toThrow(expect.any(Error));

    expect(console.error).toHaveBeenCalledWith(
      "Failed to get processed images",
      expect.any(Error)
    );

    expect(console.error).toHaveBeenCalledTimes(1);
  });
});
