/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["test"],
  testMatch: ["**.test.ts"],
  coverageDirectory: "coverage",
  collectCoverageFrom: ["src/**/*.ts"],
  testTimeout: 4 * 60 * 1000,
};
