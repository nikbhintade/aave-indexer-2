// Aave V3 handler registration — each module registers its own handlers
export * from "./address-provider-registry";
export * from "./address-provider";
export * from "./pool-configurator";
export * from "./pool";
export * from "./tokenization";
export * from "./oracle";
export * from "./incentives";
export * from "./gho";

// Aave V2 handler registration
export * from "./v2/address-provider";
export * from "./v2/configurator";
export * from "./v2/lending-pool";
export * from "./v2/oracle";
export * from "./v2/tokenization";
export * from "./v2/incentives";
