import { handleApi } from "./api";
import { HttpError } from "./errors";
import { json } from "./http";
import { messages } from "./messages";
import { purgeLocationPoints } from "./store";

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }
    try {
      return await handleApi(request, env);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      console.error(JSON.stringify({ event: "unhandled", message: error instanceof Error ? error.message : "error" }));
      return json({ error: messages.genericError }, 500);
    }
  },
  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(purgeLocationPoints(env.DB, new Date()));
  },
} satisfies ExportedHandler<Env>;
