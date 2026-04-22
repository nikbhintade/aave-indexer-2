# Aave HyperIndex

Aave protocol indexer built with [Envio HyperIndex](https://docs.envio.dev). Indexes pool, oracle, rewards, and configurator events into a queryable GraphQL API.

## Prerequisites

- Node.js v22+ (v24 recommended)
- pnpm
- Docker
- `ENVIO_API_TOKEN` env var

## Commands

```bash
pnpm codegen          # Regenerate types after schema/config changes
pnpm tsc --noEmit     # Type-check
TUI_OFF=true pnpm dev # Run indexer
pnpm test             # Run tests
```

GraphQL playground at `http://localhost:8080` (password: `testing`).

## Structure

```
config.yaml       # Chain/contract/event config
schema.graphql    # Entity definitions
src/handlers/     # Event handlers
abis/             # Contract ABIs
```

## Docs

- [Envio HyperIndex docs](https://docs.envio.dev)
- [Full LLM reference](https://docs.envio.dev/docs/HyperIndex-LLM/hyperindex-complete)


## Tasks

- [ ] Data validation