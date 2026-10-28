# Catalyst CLI

`catalyst` is the command line tool for a Workshape Catalyst instance. It synchronizes agents and skills between a folder and an instance, and has one command for every asset operation, for every kind the instance registers (`catalyst <kind> <verb>`, `catalyst context`, `catalyst kinds`).

```sh
npm install --global @work-shape/catalyst-cli
catalyst --help
```

`catalyst setup <claude-code|codex|other> --instance <url>` connects an AI tool on your computer: it logs in by a code you confirm in the browser and writes the Catalyst skill the package ships to `~/.claude/skills/catalyst/` or `~/.agents/skills/catalyst/`.

It needs Node 22 or later. The key is read from `CATALYST_API_KEY`, is sent only to the instance you name over HTTPS, and is never written into the working copy.

Run `catalyst doctor` to check the address, sign-in, versions and effective key rights. Its four lines contain no keys, tokens, identities or response contents and are safe to share. Pass `--instance <url>` to select an instance explicitly. Use the instance's HTTPS origin, without `/api` or a sign-in path.

Install the CLI of the server's release. When they differ, commands print the exact update command, including prerelease versions, for example:

```powershell
npm install --global @work-shape/catalyst-cli@<server-version>
catalyst doctor
```

Replace `<server-version>` with the version in the diagnostic. Run each line separately; this also works in Windows PowerShell 5.1, which does not support `&&`. For a project-local installation, omit `--global` and run `npx catalyst doctor`. Updating the CLI preserves saved sign-ins. Run `catalyst setup <tool> --instance <url>` again to refresh the installed skill.

MIT licence.
