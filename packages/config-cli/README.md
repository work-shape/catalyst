# Catalyst CLI

`catalyst` is the command line tool for a Workshape Catalyst instance. It synchronizes agents and skills between a folder and an instance, and has one command for every asset operation, for every kind the instance registers (`catalyst <kind> <verb>`, `catalyst context`, `catalyst kinds`).

```sh
npm install --global @work-shape/catalyst-cli
catalyst --help
```

`catalyst setup <claude-code|codex|other> --instance <url>` connects an AI tool on your computer: it logs in by a code you confirm in the browser and writes the Catalyst skill the package ships to `~/.claude/skills/catalyst/` or `~/.agents/skills/catalyst/`.

It needs Node 22 or later. The key is read from `CATALYST_API_KEY`, is sent only to the instance you name over HTTPS, and is never written into the working copy.

MIT licence.
