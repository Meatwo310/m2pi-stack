# Pi packages

Place first-party Pi packages under this directory. Each package should declare its resources in `package.json` under the `pi` key, for example `pi.extensions`, `pi.skills`, or `pi.prompts`. Add the package's relative path to `pi/agent/settings.json` before enabling it.

Pi extensions execute with the full permissions of the `m2pi` user. Review and pin third-party code before loading it.
