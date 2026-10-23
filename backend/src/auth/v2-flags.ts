export function v2MarketplaceEnabled(): boolean {
  return process.env.V2_MARKETPLACE_ENABLED === 'true';
}
