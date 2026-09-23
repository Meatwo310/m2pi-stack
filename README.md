# m2pi stack

Git-managed Pi Coding Agent stack for the `m2pi` Discord bot.

## Layout

- `apps/discord-gateway`: Discord transport and per-channel Pi sessions.
- `pi/agent`: shared Pi settings and resources.
- `packages`: first-party Pi extensions and skills.
- `deploy/systemd`: user service definition.
- `config/env.example`: secrets and optional database location template.

Secrets stay in the runtime environment file. Runtime configuration is stored in SQLite. Pi sessions stay in the configured state directory; none of these files are committed.

## Configuration

`DISCORD_TOKEN` and provider API keys remain in the environment file. `M2PI_DATABASE_PATH` may override the database location. Without an override, paths are derived at runtime from the service user's home, `XDG_STATE_HOME`, and the checked-out repository location—no user home or repository path is embedded in initialization code.

All non-secret runtime settings come exclusively from SQLite; environment variables are not copied into the database and do not override it.

Initialize a new database explicitly with at least one allowed Discord user:

- `pnpm --filter @m2pi/discord-gateway config -- init DISCORD_USER_ID`

The initial working directory is the runtime user's home, the agent directory is derived from the repository root, and the session directory is derived from `XDG_STATE_HOME` (falling back to `~/.local/state`). Model and tool defaults remain application defaults and can be changed immediately after initialization.

Manage the initialized database without exposing secrets:

- `pnpm --filter @m2pi/discord-gateway config -- show`
- `pnpm --filter @m2pi/discord-gateway config -- set model openrouter/openrouter/free`
- `pnpm --filter @m2pi/discord-gateway config -- set allowed_tools read,grep`
- `pnpm --filter @m2pi/discord-gateway config -- allow-user DISCORD_USER_ID`
- `pnpm --filter @m2pi/discord-gateway config -- deny-user DISCORD_USER_ID`

The database uses WAL mode and is created with mode `0600`. Tokens and API keys are never stored in it.

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

Add a package below `packages/`, declare its resources with the package's `pi` manifest, and add its relative path to `pi/agent/settings.json`. The Gateway loads extensions, skills, and prompt templates from this shared agent directory. No model-callable tools are exposed until they are explicitly allowlisted in SQLite.
