export const CommissionModel = {
  ON_COMPLETION: 'ON_COMPLETION',
  ON_ACCEPTANCE: 'ON_ACCEPTANCE',
} as const;

export type CommissionModel =
  (typeof CommissionModel)[keyof typeof CommissionModel];

export const DEFAULT_COMMISSION_MODEL: CommissionModel =
  CommissionModel.ON_COMPLETION;

export function isCommissionModel(value: unknown): value is CommissionModel {
  return Object.values(CommissionModel).some((model) => model === value);
}

export function shouldChargeAtAcceptance(model: CommissionModel): boolean {
  return model === CommissionModel.ON_ACCEPTANCE;
}

export function shouldChargeAtCompletion(model: CommissionModel): boolean {
  return model === CommissionModel.ON_COMPLETION;
}

export function shouldRefundCustomerCancellation(model: CommissionModel): boolean {
  return model === CommissionModel.ON_ACCEPTANCE;
}
