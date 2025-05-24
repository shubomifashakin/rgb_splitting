import type { Config } from "@jest/types";

const config: Config.InitialOptions = {
  testEnvironment: "node",
  roots: ["<rootDir>/test"],
  testMatch: ["**/*.test.ts"],
  transform: {
    "^.+\\.tsx?$": "ts-jest",
  },
  collectCoverage: true,
  collectCoverageFrom: [
    "**/resources/*.ts",
    "**/helpers/fns/*.ts",
    "**/processImageFns/*.ts",
  ],
  verbose: true,
};

export default config;
