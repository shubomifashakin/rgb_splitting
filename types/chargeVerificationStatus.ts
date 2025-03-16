export interface ChargeVerificationStatus {
  data: Data;
  status: string;
  message: string;
}

interface Data {
  meta: any;
  id: number;
  ip: string;
  card: Card;
  tx_ref: string;
  amount: number;
  flw_ref: string;
  app_fee: number;
  currency: string;
  auth_model: string;
  narration: string;
  created_at: string;
  account_id: number;
  customer: Customer;
  merchant_fee: number;
  status: "successful";
  payment_type: string;
  amount_settled: number;
  charged_amount: number;
  device_fingerprint: string;
  processor_response: string;
}

export interface Card {
  type: string;
  token: string;
  expiry: string;
  issuer: string;
  country: string;
  last_4digits: string;
  first_6digits: string;
}

interface Customer {
  id: number;
  name: string;
  email: string;
  phone_number: string;
  created_at: string;
}
