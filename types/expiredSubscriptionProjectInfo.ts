import { ProjectInfo } from "./projectInfo";

export interface ExpiredProject
  extends Pick<
    ProjectInfo,
    | "email"
    | "userId"
    | "projectId"
    | "projectName"
    | "currentPlan"
    | "cardTokenInfo"
    | "nextPaymentDate"
    | "apiKeyInfo"
  > {}
