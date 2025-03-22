import { CardInfo } from "./cardInfo";
import { ApiKeyInfo } from "./apiKeyInfo";

export interface ExpiredProject {
  id: string;
  userId: string;
  projectName: string;
  currentPlan: string;
  nextPaymentDate: Date;

  cardInfo: CardInfo;
  apiKeyInfo: ApiKeyInfo;
}
