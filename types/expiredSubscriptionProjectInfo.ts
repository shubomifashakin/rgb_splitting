export interface ExpiredProject {
  id: string;
  email: string;
  userId: string;
  projectName: string;
  nextPaymentDate: number;
  currentPlan: string;

  apiKeyInfo: {
    apiKey: string;
    apiKeyId: string;
    usagePlanId: string;
  };

  cardTokenInfo: {
    token: string;
    expiry: string;
  };
}
