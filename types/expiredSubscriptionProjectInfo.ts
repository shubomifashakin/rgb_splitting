export interface ExpiredProject {
  id: string;
  userId: string;
  userEmail: string;
  projectName: string;
  currentPlan: string;
  nextPaymentDate: Date;

  apiKeyInfo: {
    apiKeyId: string;
    usagePlanId: string;
  };

  cardInfo: {
    token: string;
    expiry: string;
  };
}
