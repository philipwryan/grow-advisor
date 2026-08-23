# grow-advisor

The grow advisor's system prompt and tool definitions, in one place.

Two apps run this advisor over the same Supabase tables:

- **GrowOS** — on the Mac, on the home LAN. Reaches Home Assistant live, owns
  the camera and the journal form.
- **Ryan Life** — deployed, behind Google sign-in. Same tent, from a phone on
  mobile data.

They used to hold a copy of the prompt each. Two prompts reading one database
will eventually give different answers about the same plant, and nothing would
have told anyone. Now there is one copy, and each app supplies only its own data
layer.

## What lives here

| File | Contents |
|---|---|
| `src/prompt.ts` | The system prompt, and the roster block that goes in it |
| `src/tools.ts` | Tool descriptions and JSON schemas; every `run()` delegates |
| `src/types.ts` | The shapes both apps agree on, including `AdvisorHost` |

Nothing here reads an environment variable, opens a database connection or
imports a Supabase client. That is deliberate — it is what lets the same code
run in a local app with a service-role key and in a deployed one with a
different reader.

## What does not live here

The data layer. Each app implements `AdvisorHost`:

```ts
const tools = advisorTools(plants, host, {
  tentNowDescription:
    "Read live from Home Assistant.",              // GrowOS
    // "The most recent STORED reading, with its age — this app cannot reach
    //  Home Assistant. Say how old it is." — Ryan Life
});
```

`tentNowDescription` is a parameter rather than a constant because it is the one
place the two apps genuinely differ, and hard-coding either would make the other
lie about its own data.

## Using it

```json
"@philipwryan/grow-advisor": "github:philipwryan/grow-advisor#v1.0.0"
```

npm builds it on install via `prepare`, so no publishing step and no registry.
Pin the tag; move the tag when both apps are ready for a change.

## Changing the prompt

It is one file now, but it is still two apps' behaviour. Almost every paragraph
in `prompt.ts` is there because something went wrong without it — the roster
block exists because the model invented the cast, per-plant ages because a
replacement sowing read as a stunted plant. Read the comments before trimming.

After a change: bump the version, move the tag, and update both apps together.
