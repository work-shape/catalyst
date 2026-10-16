# Workshape Catalyst

Workshape Catalyst is the platform a company runs its AI on: agents, apps, workflows and the company knowledge they work with, on-premise or in a dedicated instance.

## What is Workshape Catalyst

People work with AI agents in a chat. When an agent builds something useful, such as a form or an overview, the team keeps it as an App. Workflows do routine work on a schedule or when someone starts them. Connections let agents work in the systems a company already uses, such as its CRM or ticket tool.

The company sets the rules. Admins decide who may use which agent and what it may touch. A person approves before a Workflow runs on its own, an App goes live or an agent acts in another system.

Each company gets an instance of its own. Workshape sets it up together with the customer and either runs it or installs it in the customer's own infrastructure.

The platform is proprietary and ships as container images. Its source code is not in this repository. This repository is the home of the parts you build against: the command line tool, the API client and contract, the asset formats and examples. These parts are MIT-licensed.

## What is in this repository

Today:

- [`examples/working-copy`](examples/working-copy): an agent and a skill as files, ready to validate and push with the CLI.
- [`SECURITY.md`](SECURITY.md): how to report a vulnerability.
- The link to the documentation below.

The CLI is already on npm as [`@work-shape/catalyst-cli`](https://www.npmjs.com/package/@work-shape/catalyst-cli). Its source and the client packages follow here under `@work-shape/catalyst-*`: the API contract with every operation of the HTTP API, a typed API client and the schemas of the asset files. Each one moves into this repository when it is published.

## Install the CLI

The `catalyst` command needs Node 22 or later.

```sh
npm install --global @work-shape/catalyst-cli
catalyst --help
```

## Connect to an instance

```sh
catalyst login --instance https://chat.example.com
catalyst context
```

`login` prints a code. Open the address it shows, signed in to the instance, check the code and confirm. The CLI then saves a key of your own. The key acts as you and never does more than you may, and you choose its scopes. Your instance must have personal API keys switched on.

To connect an AI tool on your computer, such as Claude Code or Codex, run `catalyst setup <claude-code|codex|other> --instance <address>`. It logs in the same way and writes a skill that teaches the tool to use the CLI. The tool then works on the instance as you.

## Build an app

You build an App in the chat. Describe what you need, and an agent writes it as a draft. A person publishes it.

Agents, skills, Apps, Workflows and guardrails are also files. Keep them in Git and write them with the CLI, for example `catalyst config push` for agents and skills or `catalyst app put` for an App's draft. The [example](examples/working-copy) shows the layout.

## Documentation

[docs.workshape.ai/catalyst](https://docs.workshape.ai/catalyst/) covers using an instance, configuring it, [the CLI](https://docs.workshape.ai/catalyst/configure/cli/), [config assets](https://docs.workshape.ai/catalyst/configure/config-assets/) and the [API reference](https://docs.workshape.ai/catalyst/reference/api/).

## Get in touch

To get an instance or to ask about Catalyst, write to [hello@workshape.ai](mailto:hello@workshape.ai) or use the contact form on [workshape.ai](https://workshape.ai). Report a vulnerability as [`SECURITY.md`](SECURITY.md) describes, not in a public issue.

## License

The content of this repository is MIT-licensed. See [`LICENSE`](LICENSE). The Workshape Catalyst platform is proprietary.
