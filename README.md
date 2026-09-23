# m2pi stack

Git-managed Pi Coding Agent stack for the `m2pi` Discord bot.

## Layout

- `apps/discord-gateway`: Discord transport and per-channel Pi sessions.
- `pi/agent`: shared Pi settings and resources.
- `packages`: first-party Pi extensions and skills.
- `deploy/systemd`: user service definition.
- `config/env.example`: non-secret configuration template.

Secrets stay in `/home/m2pi/.env`. Sessions stay in `/home/m2pi/.local/state/pi-discord-gateway`; neither is committed.

## Commands

- `pnpm install --frozen-lockfile --ignore-scripts`
- `pnpm check`
- `pnpm test`
- `pnpm audit:high`
- `pnpm smoke:pi`
- `pnpm pi`
- `pnpm verify`
- `./scripts/deploy.sh`

## Pi packages

Add a package below `packages/`, declare its resources with the package's `pi` manifest, and add its relative path to `pi/agent/settings.json`. The Gateway loads extensions, skills, and prompt templates from this shared agent directory. `PI_GATEWAY_TOOLS` remains empty by default, so no model-callable tools are exposed until explicitly allowlisted.
