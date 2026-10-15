# Example working copy

One agent and one skill as files. The agent `plain_writer` rewrites texts in plain language and follows the skill `plain-language`.

```text
catalyst.yaml                       the instances and which files are assets
agents/plain-writer.agent.yaml      the agent
skills/plain-language/SKILL.md      the skill
```

The files are a working copy. Nothing is live until you push it.

## Try it

Use a test instance, not one people work on. Change the `url` in `catalyst.yaml` to its address, then:

```sh
catalyst login --instance https://your-instance.example.com
catalyst config validate
catalyst config push
```

`validate` asks the instance whether it would accept the push and changes nothing. `push` creates the agent and the skill.

A push needs the right to release config assets, and your key needs the matching scope. The agent uses the tool `read_skill`, which the instance must have switched on. [Config assets](https://docs.workshape.ai/catalyst/configure/config-assets/) explains both.

`defaultAgentName` makes `plain_writer` the default agent of an empty instance. If the instance already has a default agent, delete that line before you push, and the default stays as it is.

## Next

- `catalyst config pull` replaces the folder with what is live on the instance.
- `catalyst config diff` shows what you changed and what changed on the instance since your last pull.
- Studio, the editor in the instance, shows the same agent and skill. A change there comes back with your next pull.
