import { AuthorizedApiGatewayEvent } from "../../types/AuthorizedApiGateway";

const projectId = "e7d9f390-3c4b-4d2c-97a0-bc0fa03e1f8a";

jest.mock("@aws-sdk/client-api-gateway", () => {
  return {
    APIGatewayClient: jest.fn().mockImplementation(() => ({
      send: jest.fn(),
    })),
    DeleteApiKeyCommand: jest.fn(),
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
        DeleteCommand: jest.fn(),
      };
    });

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

    const { handler } = await import("../../resources/delete_project_handler");

    const res = await handler(event);

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

  test("it should not delete the project -- error 400 no userId", async () => {
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
        DeleteCommand: jest.fn(),
      };
    });

    const event = {
      pathParameters: {
        projectId,
      },
      requestContext: {
        authorizer: {
          principalId: "", //no userId here
        },
      },
    } as unknown as AuthorizedApiGatewayEvent;

    const { handler } = await import("../../resources/delete_project_handler");

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

  test("it should not delete the project -- error 400 because invalid uuid", async () => {
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
        DeleteCommand: jest.fn(),
      };
    });

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

  test("it should not delete the project -- error 500 because of dynamo error", async () => {
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
          principalId: "1",
        },
      },
    } as unknown as AuthorizedApiGatewayEvent;

    const { handler } = await import("../../resources/delete_project_handler");

    await expect(handler(event)).rejects.toThrow("fake error");
  });
});
