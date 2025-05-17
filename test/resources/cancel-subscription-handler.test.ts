import { AuthorizedApiGatewayEvent } from "../../types/AuthorizedApiGateway";

jest.mock("@aws-sdk/client-api-gateway", () => {
  return {
    APIGatewayClient: jest.fn().mockImplementation(() => ({
      send: jest.fn(),
    })),
    UpdateApiKeyCommand: jest.fn(),
  };
});

const projectId = "e7d9f390-3c4b-4d2c-97a0-bc0fa03e1f8a";

describe("cancel-subscription-handler", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.REGION = "fake-region";
    process.env.TABLE_NAME = "fake-table-name";
  });

  test("it should cancel a subscription", async () => {
    //do the mock of dynamoDb first b4 importing the handler
    jest.doMock("@aws-sdk/lib-dynamodb", () => {
      return {
        DynamoDBDocumentClient: {
          from: jest.fn().mockImplementation(() => ({
            send: jest.fn().mockResolvedValue({
              Item: {
                apiKeyInfo: {
                  apiKeyId: "fake-api-key-id",
                  usagePlanId: "fake-usage-plan-id",
                },
              },
            }),
          })),
        },
        GetCommand: jest.fn(),
        UpdateCommand: jest.fn(),
      };
    });

    const { handler } = await import(
      "../../resources/cancel-subscription-handler"
    );

    const event = {
      pathParameters: {
        projectId,
      },
      requestContext: {
        authorizer: {
          principalId: "1",
        },
      },
    } as unknown as AuthorizedApiGatewayEvent;

    const res = await handler(event);

    expect(res).toEqual({
      statusCode: 200,
      body: JSON.stringify({ message: "Successfully cancelled subscription" }),
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Api-Key",
      },
    });
  });

  test("it should return a 400 error (invalid projectId)", async () => {
    jest.doMock("@aws-sdk/lib-dynamodb", () => {
      return {
        DynamoDBDocumentClient: {
          from: jest.fn().mockImplementation(() => ({
            send: jest.fn().mockResolvedValue({
              Item: {
                apiKeyInfo: {
                  apiKeyId: "fake-api-key-id",
                  usagePlanId: "fake-usage-plan-id",
                },
              },
            }),
          })),
        },
        GetCommand: jest.fn(),
        UpdateCommand: jest.fn(),
      };
    });

    const { handler } = await import(
      "../../resources/cancel-subscription-handler"
    );

    const event = {
      pathParameters: {
        projectId: "", //invalid uuid
      },
      requestContext: {
        authorizer: {
          principalId: "1",
        },
      },
    } as unknown as AuthorizedApiGatewayEvent;

    const res = await handler(event);

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

  test("it should return a 404 error (project not found)", async () => {
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
        UpdateCommand: jest.fn(),
      };
    });

    const { handler } = await import(
      "../../resources/cancel-subscription-handler"
    );

    const event = {
      pathParameters: {
        projectId,
      },
      requestContext: {
        authorizer: {
          principalId: "1",
        },
      },
    } as unknown as AuthorizedApiGatewayEvent;

    const res = await handler(event);

    expect(res).toEqual({
      statusCode: 404,
      body: expect.any(String),
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Api-Key",
      },
    });
  });

  test("it should return a 500 error (dynamo error)", async () => {
    jest.doMock("@aws-sdk/lib-dynamodb", () => {
      return {
        DynamoDBDocumentClient: {
          from: jest.fn().mockImplementation(() => ({
            send: jest.fn().mockRejectedValue(new Error("fake error")),
          })),
        },
        GetCommand: jest.fn(),
        UpdateCommand: jest.fn(),
      };
    });

    const { handler } = await import(
      "../../resources/cancel-subscription-handler"
    );

    const event = {
      pathParameters: {
        projectId,
      },
      requestContext: {
        authorizer: {
          principalId: "1",
        },
      },
    } as unknown as AuthorizedApiGatewayEvent;

    await expect(handler(event)).rejects.toThrow("fake error");
  });

  test("it should return a 400 error (no userId)", async () => {
    jest.doMock("@aws-sdk/lib-dynamodb", () => {
      return {
        DynamoDBDocumentClient: {
          from: jest.fn().mockImplementation(() => ({
            send: jest.fn().mockResolvedValue({
              Item: {
                apiKeyInfo: {
                  apiKeyId: "fake-api-key-id",
                  usagePlanId: "fake-usage-plan-id",
                },
              },
            }),
          })),
        },
        GetCommand: jest.fn(),
        UpdateCommand: jest.fn(),
      };
    });

    const { handler } = await import(
      "../../resources/cancel-subscription-handler"
    );

    const event = {
      pathParameters: {
        projectId,
      },
      requestContext: {
        authorizer: undefined,
      },
    } as unknown as AuthorizedApiGatewayEvent;

    const res = await handler(event);

    expect(res).toEqual({
      statusCode: 400,
      body: JSON.stringify({ message: "Unauthorized" }),
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Api-Key",
      },
    });
  });
});
