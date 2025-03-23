import { ApiKeyInfo } from "./apiKeyInfo";
import { CardTokenInfo } from "./cardTokenInfo";

export interface ProjectInfo {
  email: string;
  apiKey: string;
  userId: string;
  createdAt: number;
  projectId: string;
  sub_status: string;
  projectName: string;
  currentPlan: string;
  nextPaymentDate: number;
  currentBillingDate: number;

  apiKeyInfo: ApiKeyInfo;
  cardTokenInfo: CardTokenInfo;
}
