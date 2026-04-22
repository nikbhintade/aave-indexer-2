export function getHistoryEntityId(
  chainId: number,
  blockNumber: number,
  txHash: string,
  logIndex: number
): string {
  return `${chainId}:${blockNumber}:${txHash}:${logIndex}`;
}

export function getReserveId(
  underlyingAsset: string,
  poolId: string,
  chainId: number
): string {
  return `${chainId}-${underlyingAsset.toLowerCase()}${poolId}`;
}

export function getUserReserveId(
  userAddress: string,
  underlyingAssetAddress: string,
  poolId: string,
  chainId: number
): string {
  return `${chainId}-${userAddress.toLowerCase()}${underlyingAssetAddress.toLowerCase()}${poolId}`;
}

export function getSubTokenId(tokenAddress: string, chainId: number): string {
  return `${chainId}-${tokenAddress.toLowerCase()}`;
}
