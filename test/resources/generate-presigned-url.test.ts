import { APIGatewayProxyEventV2 } from "aws-lambda";

import { PlanType } from "../../helpers/constants";

console.log = jest.fn();
console.error = jest.fn();

const mockUUid = "test-uuid";
const mockApiKey = "test-api-key";
const mockUserId = "test-user-id";
const mockProjectId = "test-project-id";

describe("generate presigned url", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    process.env.REGION = "eu-west-2";
    process.env.BUCKET_NAME = "test-bucket";
    process.env.TABLE_NAME = "test-table";

    jest.mock("uuid", () => {
      return {
        v4: jest.fn().mockReturnValue(mockUUid),
      };
    });
  });

  test("it should generate a presigned url", async () => {
    //mock for getting the project the apikey is attached to
    const mockQueryCommand = jest.fn(() => ({
      Items: [
        {
          userId: mockUserId,
          projectId: mockProjectId,
          currentPlan: PlanType.Pro,
        },
      ],
    }));

    const normalizedChannels = JSON.stringify(["RED", "GREEN", "BLUE"]);
    const normalizedGrains = JSON.stringify([100, 100]);

    //mock of the createPresignedPost
    const mockCreatePresignedPost = jest.fn().mockResolvedValue({
      url: "test-url",
      fields: {
        "x-amz-meta-user_id": mockUserId,
        "x-amz-meta-grains": normalizedGrains,
        "x-amz-meta-project_id": mockProjectId,
        "x-amz-meta-channels": normalizedChannels,
      },
    });

    jest.mock("@aws-sdk/s3-presigned-post", () => {
      return {
        createPresignedPost: mockCreatePresignedPost,
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
        QueryCommand: mockQueryCommand,
      };
    });

    const { handler } = await import("../../resources/generate-presigned-url");

    const fakeEvent = {
      body: JSON.stringify({
        channels: ["R", "G", "B"],
        grain: [100, 100],
      }),
      headers: {
        ["x-api-key"]: mockApiKey,
      },
    } as unknown as APIGatewayProxyEventV2;

    const res = await handler(fakeEvent);

    expect(mockQueryCommand).toHaveBeenCalledTimes(1);
    expect(mockQueryCommand).toHaveBeenCalledWith({
      TableName: "test-table",
      KeyConditionExpression: "apiKey = :apiKey",
      IndexName: "apiKeyIndex",
      ExpressionAttributeValues: {
        ":apiKey": mockApiKey,
      },
      ProjectionExpression: "projectId, userId, currentPlan",
      Limit: 1,
    });

    expect(mockCreatePresignedPost).toHaveBeenCalledTimes(1);
    expect(mockCreatePresignedPost).toHaveBeenCalledWith(expect.any(Object), {
      Bucket: process.env.BUCKET_NAME!,
      Key: mockUUid + "/${filename}",
      Conditions: [
        { bucket: process.env.BUCKET_NAME! },
        ["starts-with", "$key", mockUUid],
        ["starts-with", "$Content-Type", "image/"],
        ["content-length-range", 1, 20 * 1024 * 1024],
        ["eq", "$x-amz-meta-grains", normalizedGrains],
        ["eq", "$x-amz-meta-channels", normalizedChannels],
        ["eq", "$x-amz-meta-project_id", mockProjectId],
      ],
      Fields: {
        "x-amz-meta-user_id": mockUserId,
        "x-amz-meta-project_id": mockProjectId,
        "x-amz-meta-grains": normalizedGrains,
        "x-amz-meta-channels": normalizedChannels,
      },
      Expires: 180,
    });
    expect(console.log).toHaveBeenCalledWith("completed successfully");

    expect(res).toEqual({
      statusCode: 200,
      body: JSON.stringify({
        url: "test-url",
        fields: {
          "x-amz-meta-user_id": mockUserId,
          "x-amz-meta-grains": normalizedGrains,
          "x-amz-meta-project_id": mockProjectId,
          "x-amz-meta-channels": normalizedChannels,
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

  test("it should fail because no body was sent", async () => {
    const fakeEvent = {
      body: undefined,
      headers: {
        ["x-api-key"]: mockApiKey,
      },
    } as unknown as APIGatewayProxyEventV2;

    const { handler } = await import("../../resources/generate-presigned-url");

    const res = await handler(fakeEvent);

    expect(console.error).toHaveBeenCalledWith("No event body received");

    expect(res).toEqual({
      statusCode: 400,
      body: JSON.stringify({
        message: "No process specified",
      }),
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Api-Key",
      },
    });
  });

  test("it should fail because no apikey was sent", async () => {
    const fakeEvent = {
      body: JSON.stringify({
        channels: ["R", "G", "B"],
        grain: [100, 100],
      }),
      headers: {
        ["x-api-key"]: undefined,
      },
    } as unknown as APIGatewayProxyEventV2;

    const { handler } = await import("../../resources/generate-presigned-url");

    const res = await handler(fakeEvent);

    expect(console.error).toHaveBeenCalledWith("No api key in header");

    expect(res).toEqual({
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

  test("it should fail because user sent invalid process", async () => {
    const fakeEvent = {
      body: JSON.stringify({
        channels: ["R", "G", "Bs"],
        grain: [100, 100],
      }),
      headers: {
        ["x-api-key"]: mockApiKey,
      },
    } as unknown as APIGatewayProxyEventV2;

    const { handler } = await import("../../resources/generate-presigned-url");

    const res = await handler(fakeEvent);

    expect(console.error).toHaveBeenCalledWith(
      "Error verifying process specified by user -->",
      expect.any(Object)
    );

    expect(res).toEqual({
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

  test("it should fail because all process specified by user was default", async () => {
    const fakeEvent = {
      body: JSON.stringify({
        channels: ["RGB", "RGb", "rgb"],
        grain: [0, 0, 0],
      }),
      headers: {
        ["x-api-key"]: mockApiKey,
      },
    } as unknown as APIGatewayProxyEventV2;

    const { handler } = await import("../../resources/generate-presigned-url");

    const res = await handler(fakeEvent);

    expect(console.error).toHaveBeenCalledTimes(0);

    expect(res).toEqual({
      statusCode: 400,
      body: JSON.stringify({
        message: "Process results in same image!",
      }),
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Api-Key",
      },
    });
  });

  test("it should fail because apikey was not connected to any project", async () => {
    const fakeEvent = {
      body: JSON.stringify({
        channels: ["RG", "R", "RG"],
        grain: [0, 0, 10],
      }),
      headers: {
        ["x-api-key"]: mockApiKey,
      },
    } as unknown as APIGatewayProxyEventV2;

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

    const { handler } = await import("../../resources/generate-presigned-url");

    const res = await handler(fakeEvent);

    expect(mockQueryCommand).toHaveBeenCalledTimes(1);
    expect(mockQueryCommand).toHaveBeenCalledWith({
      TableName: process.env.TABLE_NAME!,
      KeyConditionExpression: "apiKey = :apiKey",
      IndexName: "apiKeyIndex",
      ExpressionAttributeValues: {
        ":apiKey": mockApiKey,
      },
      ProjectionExpression: "projectId, userId, currentPlan",
      Limit: 1,
    });

    expect(console.error).toHaveBeenCalledTimes(0);

    expect(res).toEqual({
      statusCode: 404,
      body: JSON.stringify({
        message: "No project found",
      }),
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Api-Key",
      },
    });
  });

  test("it should fail because a free plan user tried to get multiple channels or grains", async () => {
    const fakeEvent = {
      body: JSON.stringify({
        channels: ["RG", "R", "RG"],
        grain: [0, 0, 10],
      }),
      headers: {
        ["x-api-key"]: mockApiKey,
      },
    } as unknown as APIGatewayProxyEventV2;

    const mockQueryCommand = jest.fn().mockResolvedValue({
      Items: [
        {
          userId: mockUserId,
          projectId: mockProjectId,
          currentPlan: PlanType.Free, //free plan user
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

    const { handler } = await import("../../resources/generate-presigned-url");

    const res = await handler(fakeEvent);

    expect(mockQueryCommand).toHaveBeenCalledTimes(1);
    expect(mockQueryCommand).toHaveBeenCalledWith({
      TableName: process.env.TABLE_NAME!,
      KeyConditionExpression: "apiKey = :apiKey",
      IndexName: "apiKeyIndex",
      ExpressionAttributeValues: {
        ":apiKey": mockApiKey,
      },
      ProjectionExpression: "projectId, userId, currentPlan",
      Limit: 1,
    });

    expect(console.error).toHaveBeenCalledTimes(0);

    expect(res).toEqual({
      statusCode: 400,
      body: JSON.stringify({
        message: "Free Plan does not support multiple channels or grains.",
      }),
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Api-Key",
      },
    });
  });

  test("it should fail because a dynamo failed to fetch project", async () => {
    const fakeEvent = {
      body: JSON.stringify({
        channels: ["RG", "R", "RG"],
        grain: [0, 0, 10],
      }),
      headers: {
        ["x-api-key"]: mockApiKey,
      },
    } as unknown as APIGatewayProxyEventV2;

    const mockQueryCommand = jest
      .fn()
      .mockRejectedValue(new Error("Failed to fetch project"));

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

    const { handler } = await import("../../resources/generate-presigned-url");

    await expect(handler(fakeEvent)).rejects.toThrow(Error);

    expect(mockQueryCommand).toHaveBeenCalledTimes(1);
    expect(mockQueryCommand).toHaveBeenCalledWith({
      TableName: process.env.TABLE_NAME!,
      KeyConditionExpression: "apiKey = :apiKey",
      IndexName: "apiKeyIndex",
      ExpressionAttributeValues: {
        ":apiKey": mockApiKey,
      },
      ProjectionExpression: "projectId, userId, currentPlan",
      Limit: 1,
    });

    expect(console.error).toHaveBeenCalledTimes(1);

    expect(console.error).toHaveBeenCalledWith(
      "ERROR GENERATING PRESIGNED URL",
      expect.any(Error)
    );
  });
});
