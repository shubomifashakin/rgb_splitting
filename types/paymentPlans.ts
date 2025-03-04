export interface PaymentPlan {
  id: number;
  name: string;
  amount: number;
  status: string;
  interval: string;
  currency: string;
  duration: number;
  plan_token: string;
  created_at: string;
}

interface PageInfo {
  total: number;
  total_pages: number;
  current_page: number;
}

interface Meta {
  page_info: PageInfo;
}

export interface PaymentPlansResponse {
  meta: Meta;
  status: string;
  message: string;
  data: PaymentPlan[];
}
