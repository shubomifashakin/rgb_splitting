import { PROJECT_STATUS } from "../helpers/constants";
import { ApiKeyInfo } from "./apiKeyInfo";
import { CardTokenInfo } from "./cardTokenInfo";

export interface ProjectInfo {
  email: string;
  apiKey: string;
  userId: string;
  createdAt: number;
  projectId: string;
  projectName: string;
  currentPlan: string;
  nextPaymentDate: number;
  currentBillingDate: number;

  apiKeyInfo: ApiKeyInfo;
  sub_status: PROJECT_STATUS;
  cardTokenInfo: CardTokenInfo;
}
