import { z } from "zod";

export const webHookEventSchema = z.object({
  event: z.enum(["charge.completed"]),
  data: z.object({}).passthrough(),
  meta_data: z.object({
    projectId: z.string(),
    userId: z.string(),
    usagePlanId: z.string(),
    projectName: z.string(),
    planName: z.string(),
  }),
});

interface Customer {
  id: number;
  email: string;
  created_at: string;
  name: string | null;
  phone_number: string | null;
}

interface Card {
  type: string;
  issuer: string;
  expiry: string;
  country: string;
  first_6digits: string;
  last_4digits: string;
}

export interface ChargeCompletedData {
  ip: string;
  card: Card;
  id: number;
  amount: number;
  tx_ref: string;
  status: string;
  flw_ref: string;
  app_fee: number;
  currency: string;
  narration: string;
  account_id: number;
  auth_model: string;
  created_at: string;
  merchant_fee: number;
  payment_type: string;
  charged_amount: number;
  device_fingerprint: string;
  processor_response: string;

  customer: Customer;
}
