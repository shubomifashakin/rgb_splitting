jest.mock("buffer", () => {
  const original = jest.requireActual("buffer");
  return {
    ...original,
    Buffer: {
      ...original.Buffer,
      from: jest.fn().mockImplementation((data, encoding = "utf8") => {
        if (typeof data === "string") {
          return Buffer.alloc(data.length, data);
        } else if (typeof data === "number") {
          return Buffer.alloc(data);
        } else {
          return original.Buffer.from(data, encoding);
        }
      }),
    },
  };
});

import { S3Event } from "aws-lambda";
import { NormalizedChannels } from "../../types/channels";

console.log = jest.fn();
console.error = jest.fn();

const width = 200,
  height = 1500;

const fakeUserId = "123e4567-e89b-12d3-a456-426614174000";
const fakeProjectId = "550e8400-e29b-41d4-a716-446655440000";

//dynamodb mocks
const mockPutCommand = jest.fn();

//s3 mocks
const mockPutS3ObjectCommand = jest.fn();

const mockImageData = new Uint8Array([
  255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255,
]);

const mockTransformToByteArray = jest.fn().mockResolvedValue(mockImageData);

// const mockGetS3ObjectCommand = jest.fn().mockResolvedValue({
//   Body: {
//     transformToByteArray: mockTransformToByteArray,
//   },
//   Metadata: {
//     project_id: fakeProjectId,
//     user_id: fakeUserId,
//     grains: JSON.stringify([100]),
//     channels: JSON.stringify([NormalizedChannels.REDGREENBLUE]),
//   },
// });

const equalValuesBucketName = "equal-values";
const equalValuesButSameImagePresent = "equal-values-but-same-image-present";

const moreGrainsBucketName = "more-grains";
const moreGrainsButSameImagePresent = "more-grains-but-same-image-present";

const moreChannelsBucketName = "more-channels";
const moreChannelsButSameImagePresent = "more-channels-but-same-image-present";

const oneGrainMoreChannelsBucketName = "one-grain-more-channels";
const oneGrainMoreChannelsButSameImagePresent =
  "one-grain-more-channels-but-same-image-present";

const oneChannelMoreGrainsBucketName = "one-channel-more-grains";
const oneChannelMoreGrainsButSameImagePresent =
  "one-channel-more-grains-but-same-image-present";

const mockGetS3ObjectCommand = jest.fn().mockImplementation((command) => {
  let grainValue, channelsValue;

  //channels === grains
  if (command.Bucket === equalValuesBucketName) {
    grainValue = JSON.stringify([100]);

    channelsValue = JSON.stringify([NormalizedChannels.REDGREENBLUE]);
  }

  //channels == grains but same image present
  if (command.Bucket === equalValuesButSameImagePresent) {
    grainValue = JSON.stringify([100, 0]);

    channelsValue = JSON.stringify([
      NormalizedChannels.REDGREENBLUE,
      NormalizedChannels.REDGREENBLUE,
    ]);
  }

  //channels > grains but grains > 2
  if (command.Bucket === moreChannelsBucketName) {
    grainValue = JSON.stringify([100, 200]);

    channelsValue = JSON.stringify([
      NormalizedChannels.REDGREEN,
      NormalizedChannels.RED,
      NormalizedChannels.GREEN,
    ]);
  }

  //channels > grains but grains > 2 & there is a process that results in the same image
  if (command.Bucket === moreChannelsButSameImagePresent) {
    grainValue = JSON.stringify([100, 0]);

    channelsValue = JSON.stringify([
      NormalizedChannels.REDGREEN,
      NormalizedChannels.REDGREENBLUE,
      NormalizedChannels.GREEN,
    ]);
  }

  //grains > channels but channels > 2
  if (command.Bucket === moreGrainsBucketName) {
    grainValue = JSON.stringify([100, 200, 400]);

    channelsValue = JSON.stringify([
      NormalizedChannels.REDGREEN,
      NormalizedChannels.RED,
    ]);
  }

  //grains > channels but channels > 2 & there is a process that results in the same image
  if (command.Bucket === moreGrainsButSameImagePresent) {
    grainValue = JSON.stringify([100, 0, 400]);

    channelsValue = JSON.stringify([
      NormalizedChannels.REDGREEN,
      NormalizedChannels.REDGREENBLUE,
    ]);
  }

  //1 channel and grains > channels
  if (command.Bucket === oneChannelMoreGrainsBucketName) {
    grainValue = JSON.stringify([100, 200]);

    channelsValue = JSON.stringify([NormalizedChannels.BLUE]);
  }

  //1 channel and grains > channels & there is a process that results in the same image
  if (command.Bucket === oneChannelMoreGrainsButSameImagePresent) {
    grainValue = JSON.stringify([0, 200]);

    channelsValue = JSON.stringify([NormalizedChannels.REDGREENBLUE]);
  }

  //1 grain and channels > grain
  if (command.Bucket === oneGrainMoreChannelsBucketName) {
    grainValue = JSON.stringify([100]);

    channelsValue = JSON.stringify([
      NormalizedChannels.REDGREEN,
      NormalizedChannels.GREENBLUE,
    ]);
  }

  //1 grain and channels > grain & there is a process that results in the same image
  if (command.Bucket === oneGrainMoreChannelsButSameImagePresent) {
    grainValue = JSON.stringify([0]);

    channelsValue = JSON.stringify([
      NormalizedChannels.REDGREEN,
      NormalizedChannels.REDGREENBLUE,
    ]);
  }

  return {
    Body: {
      transformToByteArray: mockTransformToByteArray,
    },
    Metadata: {
      project_id: fakeProjectId,
      user_id: fakeUserId,
      grains: grainValue,
      channels: channelsValue,
    },
  };
});

//canvas mocks
const mockToBuffer = jest.fn().mockReturnValue(Buffer.from("mock-image-data"));
const mockLoadImage = jest.fn().mockResolvedValue({
  width,
  height,
});
const mockDrawImage = jest.fn();
const mockGetImageData = jest.fn().mockReturnValue({
  data: new Uint8ClampedArray(width * height * 4),
});
const mockPutImageData = jest.fn();
const mockClearRect = jest.fn();
const mockGetContext = jest.fn().mockImplementation(() => {
  return {
    clearRect: mockClearRect,
    drawImage: mockDrawImage,
    getImageData: mockGetImageData,
    putImageData: mockPutImageData,
  };
});
const mockCreateCanvas = jest.fn().mockImplementation(() => {
  return {
    toBuffer: mockToBuffer,
    getContext: mockGetContext,
    width,
    height,
  };
});

const mockFormImageData = jest.fn().mockImplementation(() => {
  return {
    data: new Uint8ClampedArray(200 * 1500 * 4),
    width,
    height,
  };
});

function executeMocks() {
  jest.mock("@aws-sdk/lib-dynamodb", () => {
    return {
      DynamoDBDocumentClient: {
        from: jest.fn().mockImplementation(() => ({
          send: jest.fn().mockImplementation((command) => {
            return command;
          }),
        })),
      },
      PutCommand: mockPutCommand,
    };
  });

  jest.mock("@aws-sdk/client-s3", () => {
    return {
      S3Client: jest.fn().mockImplementation(() => ({
        send: jest.fn().mockImplementation((command) => {
          return command;
        }),
      })),

      GetObjectCommand: mockGetS3ObjectCommand,
      PutObjectCommand: mockPutS3ObjectCommand,
    };
  });

  jest.mock("canvas", () => {
    return {
      loadImage: mockLoadImage,
      ImageData: mockFormImageData,
      createCanvas: mockCreateCanvas,
    };
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
      PutCommand: mockPutCommand,
    };
  });

  jest.mock("@aws-sdk/client-s3", () => {
    return {
      S3Client: jest.fn().mockImplementation(() => ({
        send: jest.fn().mockImplementation((command) => {
          return command;
        }),
      })),

      GetObjectCommand: mockGetS3ObjectCommand,
      PutObjectCommand: mockPutS3ObjectCommand,
    };
  });

  jest.mock("canvas", () => {
    return {
      loadImage: mockLoadImage,
      ImageData: mockFormImageData,
      createCanvas: mockCreateCanvas,
    };
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
      PutCommand: mockPutCommand,
    };
  });

  jest.mock("@aws-sdk/client-s3", () => {
    return {
      S3Client: jest.fn().mockImplementation(() => ({
        send: jest.fn().mockImplementation((command) => {
          return command;
        }),
      })),

      GetObjectCommand: mockGetS3ObjectCommand,
      PutObjectCommand: mockPutS3ObjectCommand,
    };
  });

  jest.mock("canvas", () => {
    return {
      loadImage: mockLoadImage,
      ImageData: mockFormImageData,
      createCanvas: mockCreateCanvas,
    };
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
      PutCommand: mockPutCommand,
    };
  });

  jest.mock("@aws-sdk/client-s3", () => {
    return {
      S3Client: jest.fn().mockImplementation(() => ({
        send: jest.fn().mockImplementation((command) => {
          return command;
        }),
      })),

      GetObjectCommand: mockGetS3ObjectCommand,
      PutObjectCommand: mockPutS3ObjectCommand,
    };
  });

  jest.mock("canvas", () => {
    return {
      loadImage: mockLoadImage,
      ImageData: mockFormImageData,
      createCanvas: mockCreateCanvas,
    };
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
      PutCommand: mockPutCommand,
    };
  });

  jest.mock("@aws-sdk/client-s3", () => {
    return {
      S3Client: jest.fn().mockImplementation(() => ({
        send: jest.fn().mockImplementation((command) => {
          return command;
        }),
      })),

      GetObjectCommand: mockGetS3ObjectCommand,
      PutObjectCommand: mockPutS3ObjectCommand,
    };
  });

  jest.mock("canvas", () => {
    return {
      loadImage: mockLoadImage,
      ImageData: mockFormImageData,
      createCanvas: mockCreateCanvas,
    };
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
      PutCommand: mockPutCommand,
    };
  });

  jest.mock("@aws-sdk/client-s3", () => {
    return {
      S3Client: jest.fn().mockImplementation(() => ({
        send: jest.fn().mockImplementation((command) => {
          return command;
        }),
      })),

      GetObjectCommand: mockGetS3ObjectCommand,
      PutObjectCommand: mockPutS3ObjectCommand,
    };
  });

  jest.mock("canvas", () => {
    return {
      loadImage: mockLoadImage,
      ImageData: mockFormImageData,
      createCanvas: mockCreateCanvas,
    };
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
      PutCommand: mockPutCommand,
    };
  });

  jest.mock("@aws-sdk/client-s3", () => {
    return {
      S3Client: jest.fn().mockImplementation(() => ({
        send: jest.fn().mockImplementation((command) => {
          return command;
        }),
      })),

      GetObjectCommand: mockGetS3ObjectCommand,
      PutObjectCommand: mockPutS3ObjectCommand,
    };
  });

  jest.mock("canvas", () => {
    return {
      loadImage: mockLoadImage,
      ImageData: mockFormImageData,
      createCanvas: mockCreateCanvas,
    };
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
      PutCommand: mockPutCommand,
    };
  });

  jest.mock("@aws-sdk/client-s3", () => {
    return {
      S3Client: jest.fn().mockImplementation(() => ({
        send: jest.fn().mockImplementation((command) => {
          return command;
        }),
      })),

      GetObjectCommand: mockGetS3ObjectCommand,
      PutObjectCommand: mockPutS3ObjectCommand,
    };
  });

  jest.mock("canvas", () => {
    return {
      loadImage: mockLoadImage,
      ImageData: mockFormImageData,
      createCanvas: mockCreateCanvas,
    };
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
      PutCommand: mockPutCommand,
    };
  });

  jest.mock("@aws-sdk/client-s3", () => {
    return {
      S3Client: jest.fn().mockImplementation(() => ({
        send: jest.fn().mockImplementation((command) => {
          return command;
        }),
      })),

      GetObjectCommand: mockGetS3ObjectCommand,
      PutObjectCommand: mockPutS3ObjectCommand,
    };
  });

  jest.mock("canvas", () => {
    return {
      loadImage: mockLoadImage,
      ImageData: mockFormImageData,
      createCanvas: mockCreateCanvas,
    };
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
      PutCommand: mockPutCommand,
    };
  });

  jest.mock("@aws-sdk/client-s3", () => {
    return {
      S3Client: jest.fn().mockImplementation(() => ({
        send: jest.fn().mockImplementation((command) => {
          return command;
        }),
      })),

      GetObjectCommand: mockGetS3ObjectCommand,
      PutObjectCommand: mockPutS3ObjectCommand,
    };
  });

  jest.mock("canvas", () => {
    return {
      loadImage: mockLoadImage,
      ImageData: mockFormImageData,
      createCanvas: mockCreateCanvas,
    };
  });
}

describe("splitting handler", () => {
  beforeEach(async () => {
    jest.resetModules();
    jest.clearAllMocks();

    process.env.REGION = "mock-region";
    process.env.RESULTS_TABLE_NAME = "mock-table-name";
  });

  test("it should split the image -- channels and grains are equal", async () => {
    executeMocks();

    const { handler } = await import("../../resources/splitting-handler");

    const mockImageKey = "mock-key";
    const mockBucketName = equalValuesBucketName;

    const mockEvent = {
      Records: [
        {
          s3: {
            bucket: {
              name: mockBucketName,
            },
            object: {
              key: mockImageKey,
            },
          },
        },
      ],
    };

    await handler(mockEvent as unknown as S3Event);

    expect(mockGetS3ObjectCommand).toHaveBeenCalledWith({
      Bucket: mockBucketName,
      Key: mockImageKey,
    });

    expect(mockTransformToByteArray).toHaveBeenCalledTimes(1);

    expect(mockLoadImage).toHaveBeenCalledTimes(1);

    expect(mockCreateCanvas).toHaveBeenCalledTimes(1);
    expect(mockCreateCanvas).toHaveBeenCalledWith(width, height);

    expect(mockGetContext).toHaveBeenCalledTimes(1);
    expect(mockGetContext).toHaveBeenCalledWith("2d");

    expect(mockDrawImage).toHaveBeenCalledTimes(1);
    expect(mockDrawImage).toHaveBeenCalledWith({ width, height }, 0, 0);

    expect(mockGetImageData).toHaveBeenCalledWith(0, 0, width, height);

    expect(mockClearRect).toHaveBeenCalledTimes(1);
    expect(mockClearRect).toHaveBeenCalledWith(0, 0, width, height);

    expect(mockPutImageData).toHaveBeenCalledTimes(1);
    expect(mockPutImageData).toHaveBeenCalledWith(expect.any(Object), 0, 0);

    expect(mockToBuffer).toHaveBeenCalledTimes(1);

    expect(mockPutS3ObjectCommand).toHaveBeenCalledTimes(1);
    expect(mockPutS3ObjectCommand).toHaveBeenCalledWith({
      Body: expect.any(Buffer),
      ContentType: "image/jpeg",
      Bucket: mockBucketName,
      Key: `${mockImageKey}/${NormalizedChannels.REDGREENBLUE}-${100}.jpg`,
    });

    expect(mockPutCommand).toHaveBeenCalledTimes(1);
    expect(mockPutCommand).toHaveBeenCalledWith({
      TableName: process.env.RESULTS_TABLE_NAME,
      Item: {
        userId: fakeUserId,
        results: [
          {
            url: `https://${mockBucketName}.s3.${
              process.env.REGION
            }.amazonaws.com/${mockImageKey}/${
              NormalizedChannels.REDGREENBLUE
            }-${100}.jpg`,
            grain: 100,
            channels: NormalizedChannels.REDGREENBLUE,
          },
        ],
        imageId: mockImageKey,
        projectId: fakeProjectId,
        originalImageUrl: `https://${mockBucketName}.s3.${process.env.REGION}.amazonaws.com/${mockImageKey}`,
        createdAt: expect.any(Number),
      },
    });

    expect(console.log).toHaveBeenLastCalledWith("completed successfully");
  });

  test("it should split the image -- channels and grains are equal -- same image present", async () => {
    executeMocks();

    const { handler } = await import("../../resources/splitting-handler");

    const mockImageKey = "mock-key";
    const mockBucketName = equalValuesButSameImagePresent;

    const mockEvent = {
      Records: [
        {
          s3: {
            bucket: {
              name: mockBucketName,
            },
            object: {
              key: mockImageKey,
            },
          },
        },
      ],
    };

    await handler(mockEvent as unknown as S3Event);

    expect(mockGetS3ObjectCommand).toHaveBeenCalledWith({
      Bucket: mockBucketName,
      Key: mockImageKey,
    });

    expect(mockTransformToByteArray).toHaveBeenCalledTimes(1);

    expect(mockLoadImage).toHaveBeenCalledTimes(1);

    expect(mockCreateCanvas).toHaveBeenCalledTimes(1);
    expect(mockCreateCanvas).toHaveBeenCalledWith(width, height);

    expect(mockGetContext).toHaveBeenCalledTimes(1);
    expect(mockGetContext).toHaveBeenCalledWith("2d");

    expect(mockDrawImage).toHaveBeenCalledTimes(1);
    expect(mockDrawImage).toHaveBeenCalledWith({ width, height }, 0, 0);

    expect(mockGetImageData).toHaveBeenCalledWith(0, 0, width, height);

    expect(mockClearRect).toHaveBeenCalledTimes(1);
    expect(mockClearRect).toHaveBeenCalledWith(0, 0, width, height);

    expect(mockPutImageData).toHaveBeenCalledTimes(1);
    expect(mockPutImageData).toHaveBeenCalledWith(expect.any(Object), 0, 0);

    expect(mockToBuffer).toHaveBeenCalledTimes(1);

    expect(mockPutS3ObjectCommand).toHaveBeenCalledTimes(1);
    expect(mockPutS3ObjectCommand).toHaveBeenCalledWith({
      Body: expect.any(Buffer),
      ContentType: "image/jpeg",
      Bucket: mockBucketName,
      Key: `${mockImageKey}/${NormalizedChannels.REDGREENBLUE}-${100}.jpg`,
    });

    expect(mockPutCommand).toHaveBeenCalledTimes(1);
    expect(mockPutCommand).toHaveBeenCalledWith({
      TableName: process.env.RESULTS_TABLE_NAME,
      Item: {
        userId: fakeUserId,
        results: [
          {
            url: `https://${mockBucketName}.s3.${
              process.env.REGION
            }.amazonaws.com/${mockImageKey}/${
              NormalizedChannels.REDGREENBLUE
            }-${100}.jpg`,
            grain: 100,
            channels: NormalizedChannels.REDGREENBLUE,
          },
        ],
        imageId: mockImageKey,
        projectId: fakeProjectId,
        originalImageUrl: `https://${mockBucketName}.s3.${process.env.REGION}.amazonaws.com/${mockImageKey}`,
        createdAt: expect.any(Number),
      },
    });

    expect(console.log).toHaveBeenLastCalledWith("completed successfully");
  });

  test("it should split the image -- more channels than grains", async () => {
    executeMocks();

    const { handler } = await import("../../resources/splitting-handler");

    const mockImageKey = "mock-key";
    const mockBucketName = moreChannelsBucketName;

    const mockEvent = {
      Records: [
        {
          s3: {
            bucket: {
              name: mockBucketName,
            },
            object: {
              key: mockImageKey,
            },
          },
        },
      ],
    };

    await handler(mockEvent as unknown as S3Event);

    expect(mockGetS3ObjectCommand).toHaveBeenCalledWith({
      Bucket: mockBucketName,
      Key: mockImageKey,
    });

    expect(mockTransformToByteArray).toHaveBeenCalledTimes(1);

    expect(mockLoadImage).toHaveBeenCalledTimes(1);

    expect(mockCreateCanvas).toHaveBeenCalledTimes(1);
    expect(mockCreateCanvas).toHaveBeenCalledWith(width, height);

    expect(mockGetContext).toHaveBeenCalledTimes(1);
    expect(mockGetContext).toHaveBeenCalledWith("2d");

    expect(mockDrawImage).toHaveBeenCalledTimes(1);
    expect(mockDrawImage).toHaveBeenCalledWith({ width, height }, 0, 0);

    expect(mockGetImageData).toHaveBeenCalledWith(0, 0, width, height);

    expect(mockClearRect).toHaveBeenCalledTimes(3);
    expect(mockClearRect).toHaveBeenCalledWith(0, 0, width, height);

    expect(mockPutImageData).toHaveBeenCalledTimes(3);
    expect(mockPutImageData).toHaveBeenCalledWith(expect.any(Object), 0, 0);

    expect(mockToBuffer).toHaveBeenCalledTimes(3);

    expect(mockPutS3ObjectCommand).toHaveBeenCalledTimes(3);
    expect(mockPutS3ObjectCommand).toHaveBeenCalledWith({
      Body: expect.any(Buffer),
      ContentType: "image/jpeg",
      Bucket: mockBucketName,
      Key: `${mockImageKey}/${NormalizedChannels.REDGREEN}-${100}.jpg`,
    });

    expect(mockPutS3ObjectCommand).toHaveBeenCalledWith({
      Body: expect.any(Buffer),
      ContentType: "image/jpeg",
      Bucket: mockBucketName,
      Key: `${mockImageKey}/${NormalizedChannels.RED}-${200}.jpg`,
    });

    expect(mockPutS3ObjectCommand).toHaveBeenCalledWith({
      Body: expect.any(Buffer),
      ContentType: "image/jpeg",
      Bucket: mockBucketName,
      Key: `${mockImageKey}/${NormalizedChannels.GREEN}-${0}.jpg`,
    });

    expect(mockPutCommand).toHaveBeenCalledTimes(1);
    expect(mockPutCommand).toHaveBeenCalledWith({
      TableName: process.env.RESULTS_TABLE_NAME,
      Item: {
        userId: fakeUserId,
        results: [
          {
            url: `https://${mockBucketName}.s3.${
              process.env.REGION
            }.amazonaws.com/${mockImageKey}/${
              NormalizedChannels.REDGREEN
            }-${100}.jpg`,
            grain: 100,
            channels: NormalizedChannels.REDGREEN,
          },
          {
            url: `https://${mockBucketName}.s3.${
              process.env.REGION
            }.amazonaws.com/${mockImageKey}/${
              NormalizedChannels.RED
            }-${200}.jpg`,
            grain: 200,
            channels: NormalizedChannels.RED,
          },
          {
            url: `https://${mockBucketName}.s3.${
              process.env.REGION
            }.amazonaws.com/${mockImageKey}/${
              NormalizedChannels.GREEN
            }-${0}.jpg`,
            grain: 0,
            channels: NormalizedChannels.GREEN,
          },
        ],
        imageId: mockImageKey,
        projectId: fakeProjectId,
        originalImageUrl: `https://${mockBucketName}.s3.${process.env.REGION}.amazonaws.com/${mockImageKey}`,
        createdAt: expect.any(Number),
      },
    });

    expect(console.log).toHaveBeenLastCalledWith("completed successfully");
  });

  test("it should split the image -- more channels than grains -- same image present", async () => {
    executeMocks();

    const { handler } = await import("../../resources/splitting-handler");

    const mockImageKey = "mock-key";
    const mockBucketName = moreChannelsButSameImagePresent;

    const mockEvent = {
      Records: [
        {
          s3: {
            bucket: {
              name: mockBucketName,
            },
            object: {
              key: mockImageKey,
            },
          },
        },
      ],
    };

    await handler(mockEvent as unknown as S3Event);

    expect(mockGetS3ObjectCommand).toHaveBeenCalledWith({
      Bucket: mockBucketName,
      Key: mockImageKey,
    });

    expect(mockTransformToByteArray).toHaveBeenCalledTimes(1);

    expect(mockLoadImage).toHaveBeenCalledTimes(1);

    expect(mockCreateCanvas).toHaveBeenCalledTimes(1);
    expect(mockCreateCanvas).toHaveBeenCalledWith(width, height);

    expect(mockGetContext).toHaveBeenCalledTimes(1);
    expect(mockGetContext).toHaveBeenCalledWith("2d");

    expect(mockDrawImage).toHaveBeenCalledTimes(1);
    expect(mockDrawImage).toHaveBeenCalledWith({ width, height }, 0, 0);

    expect(mockGetImageData).toHaveBeenCalledWith(0, 0, width, height);

    expect(mockClearRect).toHaveBeenCalledTimes(2);
    expect(mockClearRect).toHaveBeenCalledWith(0, 0, width, height);

    expect(mockPutImageData).toHaveBeenCalledTimes(2);
    expect(mockPutImageData).toHaveBeenCalledWith(expect.any(Object), 0, 0);

    expect(mockToBuffer).toHaveBeenCalledTimes(2);

    expect(mockPutS3ObjectCommand).toHaveBeenCalledTimes(2);
    expect(mockPutS3ObjectCommand).toHaveBeenCalledWith({
      Body: expect.any(Buffer),
      ContentType: "image/jpeg",
      Bucket: mockBucketName,
      Key: `${mockImageKey}/${NormalizedChannels.REDGREEN}-${100}.jpg`,
    });

    expect(mockPutS3ObjectCommand).toHaveBeenCalledWith({
      Body: expect.any(Buffer),
      ContentType: "image/jpeg",
      Bucket: mockBucketName,
      Key: `${mockImageKey}/${NormalizedChannels.GREEN}-${0}.jpg`,
    });

    expect(mockPutCommand).toHaveBeenCalledTimes(1);
    expect(mockPutCommand).toHaveBeenCalledWith({
      TableName: process.env.RESULTS_TABLE_NAME,
      Item: {
        userId: fakeUserId,
        results: [
          {
            url: `https://${mockBucketName}.s3.${
              process.env.REGION
            }.amazonaws.com/${mockImageKey}/${
              NormalizedChannels.REDGREEN
            }-${100}.jpg`,
            grain: 100,
            channels: NormalizedChannels.REDGREEN,
          },
          {
            url: `https://${mockBucketName}.s3.${
              process.env.REGION
            }.amazonaws.com/${mockImageKey}/${
              NormalizedChannels.GREEN
            }-${0}.jpg`,
            grain: 0,
            channels: NormalizedChannels.GREEN,
          },
        ],
        imageId: mockImageKey,
        projectId: fakeProjectId,
        originalImageUrl: `https://${mockBucketName}.s3.${process.env.REGION}.amazonaws.com/${mockImageKey}`,
        createdAt: expect.any(Number),
      },
    });

    expect(console.log).toHaveBeenLastCalledWith("completed successfully");
  });

  test("it should split the image -- more grains than channels", async () => {
    executeMocks();

    const { handler } = await import("../../resources/splitting-handler");

    const mockImageKey = "mock-key";
    const mockBucketName = moreGrainsBucketName;

    const mockEvent = {
      Records: [
        {
          s3: {
            bucket: {
              name: mockBucketName,
            },
            object: {
              key: mockImageKey,
            },
          },
        },
      ],
    };

    await handler(mockEvent as unknown as S3Event);

    expect(mockGetS3ObjectCommand).toHaveBeenCalledWith({
      Bucket: mockBucketName,
      Key: mockImageKey,
    });

    expect(mockTransformToByteArray).toHaveBeenCalledTimes(1);

    expect(mockLoadImage).toHaveBeenCalledTimes(1);

    expect(mockCreateCanvas).toHaveBeenCalledTimes(1);
    expect(mockCreateCanvas).toHaveBeenCalledWith(width, height);

    expect(mockGetContext).toHaveBeenCalledTimes(1);
    expect(mockGetContext).toHaveBeenCalledWith("2d");

    expect(mockDrawImage).toHaveBeenCalledTimes(1);
    expect(mockDrawImage).toHaveBeenCalledWith({ width, height }, 0, 0);

    expect(mockGetImageData).toHaveBeenCalledWith(0, 0, width, height);

    expect(mockClearRect).toHaveBeenCalledTimes(2);
    expect(mockClearRect).toHaveBeenCalledWith(0, 0, width, height);

    expect(mockPutImageData).toHaveBeenCalledTimes(2);
    expect(mockPutImageData).toHaveBeenCalledWith(expect.any(Object), 0, 0);

    expect(mockToBuffer).toHaveBeenCalledTimes(2);

    expect(mockPutS3ObjectCommand).toHaveBeenCalledTimes(2);
    expect(mockPutS3ObjectCommand).toHaveBeenCalledWith({
      Body: expect.any(Buffer),
      ContentType: "image/jpeg",
      Bucket: mockBucketName,
      Key: `${mockImageKey}/${NormalizedChannels.REDGREEN}-${100}.jpg`,
    });

    expect(mockPutS3ObjectCommand).toHaveBeenCalledWith({
      Body: expect.any(Buffer),
      ContentType: "image/jpeg",
      Bucket: mockBucketName,
      Key: `${mockImageKey}/${NormalizedChannels.RED}-${200}.jpg`,
    });

    expect(mockPutCommand).toHaveBeenCalledTimes(1);
    expect(mockPutCommand).toHaveBeenCalledWith({
      TableName: process.env.RESULTS_TABLE_NAME,
      Item: {
        userId: fakeUserId,
        results: [
          {
            url: `https://${mockBucketName}.s3.${
              process.env.REGION
            }.amazonaws.com/${mockImageKey}/${
              NormalizedChannels.REDGREEN
            }-${100}.jpg`,
            grain: 100,
            channels: NormalizedChannels.REDGREEN,
          },
          {
            url: `https://${mockBucketName}.s3.${
              process.env.REGION
            }.amazonaws.com/${mockImageKey}/${
              NormalizedChannels.RED
            }-${200}.jpg`,
            grain: 200,
            channels: NormalizedChannels.RED,
          },
        ],
        imageId: mockImageKey,
        projectId: fakeProjectId,
        originalImageUrl: `https://${mockBucketName}.s3.${process.env.REGION}.amazonaws.com/${mockImageKey}`,
        createdAt: expect.any(Number),
      },
    });

    expect(console.log).toHaveBeenLastCalledWith("completed successfully");
  });

  test("it should split the image -- more grains than channels -- same image present", async () => {
    executeMocks();

    const { handler } = await import("../../resources/splitting-handler");

    const mockImageKey = "mock-key";
    const mockBucketName = moreGrainsButSameImagePresent;

    const mockEvent = {
      Records: [
        {
          s3: {
            bucket: {
              name: mockBucketName,
            },
            object: {
              key: mockImageKey,
            },
          },
        },
      ],
    };

    await handler(mockEvent as unknown as S3Event);

    expect(mockGetS3ObjectCommand).toHaveBeenCalledWith({
      Bucket: mockBucketName,
      Key: mockImageKey,
    });

    expect(mockTransformToByteArray).toHaveBeenCalledTimes(1);

    expect(mockLoadImage).toHaveBeenCalledTimes(1);

    expect(mockCreateCanvas).toHaveBeenCalledTimes(1);
    expect(mockCreateCanvas).toHaveBeenCalledWith(width, height);

    expect(mockGetContext).toHaveBeenCalledTimes(1);
    expect(mockGetContext).toHaveBeenCalledWith("2d");

    expect(mockDrawImage).toHaveBeenCalledTimes(1);
    expect(mockDrawImage).toHaveBeenCalledWith({ width, height }, 0, 0);

    expect(mockGetImageData).toHaveBeenCalledWith(0, 0, width, height);

    expect(mockClearRect).toHaveBeenCalledTimes(1);
    expect(mockClearRect).toHaveBeenCalledWith(0, 0, width, height);

    expect(mockPutImageData).toHaveBeenCalledTimes(1);
    expect(mockPutImageData).toHaveBeenCalledWith(expect.any(Object), 0, 0);

    expect(mockToBuffer).toHaveBeenCalledTimes(1);

    expect(mockPutS3ObjectCommand).toHaveBeenCalledTimes(1);
    expect(mockPutS3ObjectCommand).toHaveBeenCalledWith({
      Body: expect.any(Buffer),
      ContentType: "image/jpeg",
      Bucket: mockBucketName,
      Key: `${mockImageKey}/${NormalizedChannels.REDGREEN}-${100}.jpg`,
    });

    expect(mockPutCommand).toHaveBeenCalledTimes(1);
    expect(mockPutCommand).toHaveBeenCalledWith({
      TableName: process.env.RESULTS_TABLE_NAME,
      Item: {
        userId: fakeUserId,
        results: [
          {
            url: `https://${mockBucketName}.s3.${
              process.env.REGION
            }.amazonaws.com/${mockImageKey}/${
              NormalizedChannels.REDGREEN
            }-${100}.jpg`,
            grain: 100,
            channels: NormalizedChannels.REDGREEN,
          },
        ],
        imageId: mockImageKey,
        projectId: fakeProjectId,
        originalImageUrl: `https://${mockBucketName}.s3.${process.env.REGION}.amazonaws.com/${mockImageKey}`,
        createdAt: expect.any(Number),
      },
    });

    expect(console.log).toHaveBeenLastCalledWith("completed successfully");
  });

  test("it should split the image -- one channel more grains", async () => {
    executeMocks();

    const { handler } = await import("../../resources/splitting-handler");

    const mockImageKey = "mock-key";
    const mockBucketName = oneChannelMoreGrainsBucketName;

    const mockEvent = {
      Records: [
        {
          s3: {
            bucket: {
              name: mockBucketName,
            },
            object: {
              key: mockImageKey,
            },
          },
        },
      ],
    };

    await handler(mockEvent as unknown as S3Event);

    expect(mockGetS3ObjectCommand).toHaveBeenCalledWith({
      Bucket: mockBucketName,
      Key: mockImageKey,
    });

    expect(mockTransformToByteArray).toHaveBeenCalledTimes(1);

    expect(mockLoadImage).toHaveBeenCalledTimes(1);

    expect(mockCreateCanvas).toHaveBeenCalledTimes(1);
    expect(mockCreateCanvas).toHaveBeenCalledWith(width, height);

    expect(mockGetContext).toHaveBeenCalledTimes(1);
    expect(mockGetContext).toHaveBeenCalledWith("2d");

    expect(mockDrawImage).toHaveBeenCalledTimes(1);
    expect(mockDrawImage).toHaveBeenCalledWith({ width, height }, 0, 0);

    expect(mockGetImageData).toHaveBeenCalledWith(0, 0, width, height);

    expect(mockClearRect).toHaveBeenCalledTimes(2);
    expect(mockClearRect).toHaveBeenCalledWith(0, 0, width, height);

    expect(mockPutImageData).toHaveBeenCalledTimes(2);
    expect(mockPutImageData).toHaveBeenCalledWith(expect.any(Object), 0, 0);

    expect(mockToBuffer).toHaveBeenCalledTimes(2);

    expect(mockPutS3ObjectCommand).toHaveBeenCalledTimes(2);
    expect(mockPutS3ObjectCommand).toHaveBeenCalledWith({
      Body: expect.any(Buffer),
      ContentType: "image/jpeg",
      Bucket: mockBucketName,
      Key: `${mockImageKey}/${NormalizedChannels.BLUE}-${100}.jpg`,
    });

    expect(mockPutS3ObjectCommand).toHaveBeenCalledWith({
      Body: expect.any(Buffer),
      ContentType: "image/jpeg",
      Bucket: mockBucketName,
      Key: `${mockImageKey}/${NormalizedChannels.BLUE}-${200}.jpg`,
    });

    expect(mockPutCommand).toHaveBeenCalledTimes(1);
    expect(mockPutCommand).toHaveBeenCalledWith({
      TableName: process.env.RESULTS_TABLE_NAME,
      Item: {
        userId: fakeUserId,
        results: [
          {
            url: `https://${mockBucketName}.s3.${
              process.env.REGION
            }.amazonaws.com/${mockImageKey}/${
              NormalizedChannels.BLUE
            }-${100}.jpg`,
            grain: 100,
            channels: NormalizedChannels.BLUE,
          },
          {
            url: `https://${mockBucketName}.s3.${
              process.env.REGION
            }.amazonaws.com/${mockImageKey}/${
              NormalizedChannels.BLUE
            }-${200}.jpg`,
            grain: 200,
            channels: NormalizedChannels.BLUE,
          },
        ],
        imageId: mockImageKey,
        projectId: fakeProjectId,
        originalImageUrl: `https://${mockBucketName}.s3.${process.env.REGION}.amazonaws.com/${mockImageKey}`,
        createdAt: expect.any(Number),
      },
    });

    expect(console.log).toHaveBeenLastCalledWith("completed successfully");
  });

  test("it should split the image -- one channel more grains -- same image present", async () => {
    executeMocks();

    const { handler } = await import("../../resources/splitting-handler");

    const mockImageKey = "mock-key";
    const mockBucketName = oneChannelMoreGrainsButSameImagePresent;

    const mockEvent = {
      Records: [
        {
          s3: {
            bucket: {
              name: mockBucketName,
            },
            object: {
              key: mockImageKey,
            },
          },
        },
      ],
    };

    await handler(mockEvent as unknown as S3Event);

    expect(mockGetS3ObjectCommand).toHaveBeenCalledWith({
      Bucket: mockBucketName,
      Key: mockImageKey,
    });

    expect(mockTransformToByteArray).toHaveBeenCalledTimes(1);

    expect(mockLoadImage).toHaveBeenCalledTimes(1);

    expect(mockCreateCanvas).toHaveBeenCalledTimes(1);
    expect(mockCreateCanvas).toHaveBeenCalledWith(width, height);

    expect(mockGetContext).toHaveBeenCalledTimes(1);
    expect(mockGetContext).toHaveBeenCalledWith("2d");

    expect(mockDrawImage).toHaveBeenCalledTimes(1);
    expect(mockDrawImage).toHaveBeenCalledWith({ width, height }, 0, 0);

    expect(mockGetImageData).toHaveBeenCalledWith(0, 0, width, height);

    expect(mockClearRect).toHaveBeenCalledTimes(1);
    expect(mockClearRect).toHaveBeenCalledWith(0, 0, width, height);

    expect(mockPutImageData).toHaveBeenCalledTimes(1);
    expect(mockPutImageData).toHaveBeenCalledWith(expect.any(Object), 0, 0);

    expect(mockToBuffer).toHaveBeenCalledTimes(1);

    expect(mockPutS3ObjectCommand).toHaveBeenCalledTimes(1);

    expect(mockPutS3ObjectCommand).toHaveBeenCalledWith({
      Body: expect.any(Buffer),
      ContentType: "image/jpeg",
      Bucket: mockBucketName,
      Key: `${mockImageKey}/${NormalizedChannels.REDGREENBLUE}-${200}.jpg`,
    });

    expect(mockPutCommand).toHaveBeenCalledTimes(1);
    expect(mockPutCommand).toHaveBeenCalledWith({
      TableName: process.env.RESULTS_TABLE_NAME,
      Item: {
        userId: fakeUserId,
        results: [
          {
            url: `https://${mockBucketName}.s3.${
              process.env.REGION
            }.amazonaws.com/${mockImageKey}/${
              NormalizedChannels.REDGREENBLUE
            }-${200}.jpg`,
            grain: 200,
            channels: NormalizedChannels.REDGREENBLUE,
          },
        ],
        imageId: mockImageKey,
        projectId: fakeProjectId,
        originalImageUrl: `https://${mockBucketName}.s3.${process.env.REGION}.amazonaws.com/${mockImageKey}`,
        createdAt: expect.any(Number),
      },
    });

    expect(console.log).toHaveBeenLastCalledWith("completed successfully");
  });

  test("it should split the image -- one grain more channels", async () => {
    executeMocks();

    const { handler } = await import("../../resources/splitting-handler");

    const mockImageKey = "mock-key";
    const mockBucketName = oneGrainMoreChannelsBucketName;

    const mockEvent = {
      Records: [
        {
          s3: {
            bucket: {
              name: mockBucketName,
            },
            object: {
              key: mockImageKey,
            },
          },
        },
      ],
    };

    await handler(mockEvent as unknown as S3Event);

    expect(mockGetS3ObjectCommand).toHaveBeenCalledWith({
      Bucket: mockBucketName,
      Key: mockImageKey,
    });

    expect(mockTransformToByteArray).toHaveBeenCalledTimes(1);

    expect(mockLoadImage).toHaveBeenCalledTimes(1);

    expect(mockCreateCanvas).toHaveBeenCalledTimes(1);
    expect(mockCreateCanvas).toHaveBeenCalledWith(width, height);

    expect(mockGetContext).toHaveBeenCalledTimes(1);
    expect(mockGetContext).toHaveBeenCalledWith("2d");

    expect(mockDrawImage).toHaveBeenCalledTimes(1);
    expect(mockDrawImage).toHaveBeenCalledWith({ width, height }, 0, 0);

    expect(mockGetImageData).toHaveBeenCalledWith(0, 0, width, height);

    expect(mockClearRect).toHaveBeenCalledTimes(2);
    expect(mockClearRect).toHaveBeenCalledWith(0, 0, width, height);

    expect(mockPutImageData).toHaveBeenCalledTimes(2);
    expect(mockPutImageData).toHaveBeenCalledWith(expect.any(Object), 0, 0);

    expect(mockToBuffer).toHaveBeenCalledTimes(2);

    expect(mockPutS3ObjectCommand).toHaveBeenCalledTimes(2);
    expect(mockPutS3ObjectCommand).toHaveBeenCalledWith({
      Body: expect.any(Buffer),
      ContentType: "image/jpeg",
      Bucket: mockBucketName,
      Key: `${mockImageKey}/${NormalizedChannels.REDGREEN}-${100}.jpg`,
    });

    expect(mockPutS3ObjectCommand).toHaveBeenCalledWith({
      Body: expect.any(Buffer),
      ContentType: "image/jpeg",
      Bucket: mockBucketName,
      Key: `${mockImageKey}/${NormalizedChannels.GREENBLUE}-${100}.jpg`,
    });

    expect(mockPutCommand).toHaveBeenCalledTimes(1);
    expect(mockPutCommand).toHaveBeenCalledWith({
      TableName: process.env.RESULTS_TABLE_NAME,
      Item: {
        userId: fakeUserId,
        results: [
          {
            url: `https://${mockBucketName}.s3.${
              process.env.REGION
            }.amazonaws.com/${mockImageKey}/${
              NormalizedChannels.REDGREEN
            }-${100}.jpg`,
            grain: 100,
            channels: NormalizedChannels.REDGREEN,
          },
          {
            url: `https://${mockBucketName}.s3.${
              process.env.REGION
            }.amazonaws.com/${mockImageKey}/${
              NormalizedChannels.GREENBLUE
            }-${100}.jpg`,
            grain: 100,
            channels: NormalizedChannels.GREENBLUE,
          },
        ],
        imageId: mockImageKey,
        projectId: fakeProjectId,
        originalImageUrl: `https://${mockBucketName}.s3.${process.env.REGION}.amazonaws.com/${mockImageKey}`,
        createdAt: expect.any(Number),
      },
    });

    expect(console.log).toHaveBeenLastCalledWith("completed successfully");
  });

  test("it should split the image -- one grain more channels -- but same image present", async () => {
    executeMocks();

    const { handler } = await import("../../resources/splitting-handler");

    const mockImageKey = "mock-key";
    const mockBucketName = oneGrainMoreChannelsButSameImagePresent;

    const mockEvent = {
      Records: [
        {
          s3: {
            bucket: {
              name: mockBucketName,
            },
            object: {
              key: mockImageKey,
            },
          },
        },
      ],
    };

    await handler(mockEvent as unknown as S3Event);

    expect(mockGetS3ObjectCommand).toHaveBeenCalledWith({
      Bucket: mockBucketName,
      Key: mockImageKey,
    });

    expect(mockTransformToByteArray).toHaveBeenCalledTimes(1);

    expect(mockLoadImage).toHaveBeenCalledTimes(1);

    expect(mockCreateCanvas).toHaveBeenCalledTimes(1);
    expect(mockCreateCanvas).toHaveBeenCalledWith(width, height);

    expect(mockGetContext).toHaveBeenCalledTimes(1);
    expect(mockGetContext).toHaveBeenCalledWith("2d");

    expect(mockDrawImage).toHaveBeenCalledTimes(1);
    expect(mockDrawImage).toHaveBeenCalledWith({ width, height }, 0, 0);

    expect(mockGetImageData).toHaveBeenCalledWith(0, 0, width, height);

    expect(mockClearRect).toHaveBeenCalledTimes(1);
    expect(mockClearRect).toHaveBeenCalledWith(0, 0, width, height);

    expect(mockPutImageData).toHaveBeenCalledTimes(1);
    expect(mockPutImageData).toHaveBeenCalledWith(expect.any(Object), 0, 0);

    expect(mockToBuffer).toHaveBeenCalledTimes(1);

    expect(mockPutS3ObjectCommand).toHaveBeenCalledTimes(1);
    expect(mockPutS3ObjectCommand).toHaveBeenCalledWith({
      Body: expect.any(Buffer),
      ContentType: "image/jpeg",
      Bucket: mockBucketName,
      Key: `${mockImageKey}/${NormalizedChannels.REDGREEN}-${0}.jpg`,
    });

    expect(mockPutCommand).toHaveBeenCalledTimes(1);
    expect(mockPutCommand).toHaveBeenCalledWith({
      TableName: process.env.RESULTS_TABLE_NAME,
      Item: {
        userId: fakeUserId,
        results: [
          {
            url: `https://${mockBucketName}.s3.${
              process.env.REGION
            }.amazonaws.com/${mockImageKey}/${
              NormalizedChannels.REDGREEN
            }-${0}.jpg`,
            grain: 0,
            channels: NormalizedChannels.REDGREEN,
          },
        ],
        imageId: mockImageKey,
        projectId: fakeProjectId,
        originalImageUrl: `https://${mockBucketName}.s3.${process.env.REGION}.amazonaws.com/${mockImageKey}`,
        createdAt: expect.any(Number),
      },
    });

    expect(console.log).toHaveBeenLastCalledWith("completed successfully");
  });

  test("it should throw an error because no records were found", async () => {
    const { handler } = await import("../../resources/splitting-handler");

    const mockEvent = {
      Records: [],
    };

    await expect(handler(mockEvent as unknown as S3Event)).rejects.toThrow(
      Error
    );

    expect(console.error).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith("No records found");
  });

  test("it should throw an error because s3Body was empty", async () => {
    const mockEvent = {
      Records: [
        {
          s3: {
            bucket: {
              name: "mock-bucket",
            },
            object: {
              key: "mock-key",
            },
          },
        },
      ],
    };

    jest.mock("@aws-sdk/client-s3", () => {
      return {
        S3Client: jest.fn().mockImplementation(() => ({
          send: jest.fn().mockImplementation((command) => {
            return command;
          }),
        })),

        GetObjectCommand: jest.fn().mockResolvedValue({
          Body: null,
        }),
      };
    });

    const { handler } = await import("../../resources/splitting-handler");

    await expect(handler(mockEvent as unknown as S3Event)).rejects.toThrow(
      Error
    );

    expect(console.error).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith("No image found");
  });

  test("it should throw an error because s3Image metadata was invalid", async () => {
    const mockEvent = {
      Records: [
        {
          s3: {
            bucket: {
              name: "mock-bucket",
            },
            object: {
              key: "mock-key",
            },
          },
        },
      ],
    };

    jest.mock("@aws-sdk/client-s3", () => {
      return {
        S3Client: jest.fn().mockImplementation(() => ({
          send: jest.fn().mockImplementation((command) => {
            return command;
          }),
        })),

        GetObjectCommand: jest.fn().mockResolvedValue({
          Body: {
            transformToByteArray: mockTransformToByteArray,
          },
          Metadata: {
            project_id: fakeProjectId,
            user_id: "not valid uuid",
            grains: "invalid grain",
            channels: JSON.stringify([NormalizedChannels.REDGREENBLUE]),
          },
        }),
      };
    });

    const { handler } = await import("../../resources/splitting-handler");

    await expect(handler(mockEvent as unknown as S3Event)).rejects.toThrow(
      Error
    );

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Invalid image metadata")
    );
    expect(console.error).toHaveBeenCalledTimes(2);
  });
});
