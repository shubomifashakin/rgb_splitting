# About the Project

The RGB Splitting API is a cloud-based image processing solution that enables users to upload images and decompose them into their individual red, green, and blue color channels. Built on a serverless architecture, the system leverages AWS Lambda, API Gateway, DynamoDB, and S3 to deliver scalable, cost-effective, and highly available image processing capabilities.

# Core Features

- RGB Splitting – Users send an image along with their API key as a header, and the system extracts the red, green & blue variants of the image & saves them to s3
- Grain Effect – Users can apply a simple grain effect to their image
- Object Recognition - Users can upload an image & get the objects detected in the image. (In progress)

## AWS Services

The following AWS services are used in this project:

- AWS S3
- AWS SQS
- AWS SNS
- AWS Lambda
- AWS Dynamo Db
- AWS Cloudwatch
- AWS EventBridge
- AWS Api Gateway
- AWS SecretsManager
