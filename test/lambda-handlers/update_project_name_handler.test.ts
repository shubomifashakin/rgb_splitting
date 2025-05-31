import { AuthorizedApiGatewayEvent } from "../../types/AuthorizedApiGateway";

const mockUpdateCommand = jest.fn();
const mockProjectName = "fake-project-name";
const mockUserId = "8b7e0e3c-3f4e-4868-8f06-8e8a3f5c51f2";
const mockProjectId = "6ffc1fcc-432a-4f6c-9bfc-95c505781b4e";

console.log = jest.fn();
console.error = jest.fn();

describe("update project name handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    process.env.REGION = "fake-region";
    process.env.TABLE_NAME = "fake-table";
  });

  test("it should update the project name", async () => {
    jest.mock("@aws-sdk/lib-dynamodb", () => {
      return {
        DynamoDBDocumentClient: {
          from: jest.fn().mockImplementation(() => {
            return {
              send: jest.fn().mockImplementation((command) => {
                return command;
              }),
            };
          }),
        },
        UpdateCommand: mockUpdateCommand,
      };
    });

    const { handler } = await import(
      "../../lambda-handlers/update_project_name_handler"
    );

    const event = {
      requestContext: {
        authorizer: {
          principalId: mockUserId,
        },
      },
      pathParameters: {
        projectId: mockProjectId,
      },
      body: JSON.stringify({
        projectName: mockProjectName,
      }),
    } as unknown as AuthorizedApiGatewayEvent;

    const response = await handler(event);

    expect(mockUpdateCommand).toHaveBeenCalledWith({
      TableName: process.env.TABLE_NAME,
      Key: {
        userId: mockUserId,
        projectId: mockProjectId,
      },
      ExpressionAttributeValues: {
        ":projectName": mockProjectName,
      },
      UpdateExpression: "set projectName = :projectName",
    });

    expect(console.log).toHaveBeenLastCalledWith("completed successfully");

    expect(response).toEqual({
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Api-Key",
      },
      statusCode: 200,
      body: JSON.stringify({
        message: "Success",
      }),
    });
  });

  test("it should return a 401 error due to missing userId", async () => {
    const { handler } = await import(
      "../../lambda-handlers/update_project_name_handler"
    );

    const event = {
      requestContext: {
        authorizer: {
          principalId: null,
        },
      },
      pathParameters: {
        projectId: mockProjectId,
      },
      body: JSON.stringify({
        projectName: mockProjectName,
      }),
    } as unknown as AuthorizedApiGatewayEvent;

    const response = await handler(event);

    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith("Unauthorized");

    expect(response).toEqual({
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Api-Key",
      },
      statusCode: 401,
      body: JSON.stringify({
        message: "Unauthorized",
      }),
    });
  });

  test("it should return a 400 error due to missing body", async () => {
    const { handler } = await import(
      "../../lambda-handlers/update_project_name_handler"
    );

    const event = {
      requestContext: {
        authorizer: {
          principalId: mockUserId,
        },
      },
      pathParameters: {
        projectId: mockProjectId,
      },
      body: null,
    } as unknown as AuthorizedApiGatewayEvent;

    const response = await handler(event);

    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith("No event body", null);

    expect(response).toEqual({
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Api-Key",
      },
      statusCode: 400,
      body: JSON.stringify({
        message: "Bad Request - Empty Body",
      }),
    });
  });

  test("it should return a 400 error due to invalid projectId", async () => {
    const { handler } = await import(
      "../../lambda-handlers/update_project_name_handler"
    );

    const event = {
      requestContext: {
        authorizer: {
          principalId: mockUserId,
        },
      },
      pathParameters: {
        projectId: "mockProjectId",
      },
      body: JSON.stringify({
        projectName: mockProjectName,
      }),
    } as unknown as AuthorizedApiGatewayEvent;

    const response = await handler(event);

    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      "Failed to validate project id -->",
      expect.any(Object)
    );

    expect(response).toEqual({
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Api-Key",
      },
      statusCode: 400,
      body: expect.any(String),
    });
  });

  test("it should throw a 400 due to invalid project name", async () => {
    const { handler } = await import(
      "../../lambda-handlers/update_project_name_handler"
    );

    const event = {
      requestContext: {
        authorizer: {
          principalId: mockUserId,
        },
      },
      pathParameters: {
        projectId: mockProjectId,
      },
      body: JSON.stringify({
        projectName: 200,
      }),
    } as unknown as AuthorizedApiGatewayEvent;

    const response = await handler(event);

    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      "Failed to validate project name -->",
      expect.any(Object)
    );

    expect(response).toEqual({
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Api-Key",
      },
      statusCode: 400,
      body: expect.any(String),
    });
  });

  test("it should throw an error due to dynamo failure", async () => {
    jest.mock("@aws-sdk/lib-dynamodb", () => {
      return {
        DynamoDBDocumentClient: {
          from: jest.fn().mockImplementation(() => {
            return {
              send: jest.fn().mockImplementation((command) => {
                return command;
              }),
            };
          }),
        },
        UpdateCommand: jest.fn().mockImplementation(() => {
          throw new Error("DynamoDB failure");
        }),
      };
    });

    const { handler } = await import(
      "../../lambda-handlers/update_project_name_handler"
    );

    const event = {
      requestContext: {
        authorizer: {
          principalId: mockUserId,
        },
      },
      pathParameters: {
        projectId: mockProjectId,
      },
      body: JSON.stringify({
        projectName: mockProjectName,
      }),
    } as unknown as AuthorizedApiGatewayEvent;

    await expect(handler(event)).rejects.toThrow(expect.any(Error));

    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      "Failed to update project info",
      expect.any(Error)
    );
  });
});
