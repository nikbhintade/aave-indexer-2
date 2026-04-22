import { BigDecimal } from "generated";

export const MOCK_ETHEREUM_ADDRESS = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
export const MOCK_USD_ADDRESS = "0x10f7fc1f91ba351f9c629c5947ad69bd03c05b96";
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const ZERO_BI = BigInt(0);
export const ONE_BI = BigInt(1);
export const ZERO_BD = new BigDecimal(0);
export const ONE_BD = new BigDecimal(1);

export const ETH_PRECISION = new BigDecimal(10n ** 18n);
export const USD_PRECISION = new BigDecimal(10n ** 8n);
