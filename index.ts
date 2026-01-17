import type { ClawdbotPluginApi } from "clawdbot/dist/plugins/types.js";

import { elymentsPlugin } from "./src/channel.js";

const plugin = {
  id: "elyments",
  name: "Elyments",
  description: "Elyments channel plugin (XMPP-based messaging)",
  register(api: ClawdbotPluginApi) {
    api.registerChannel({ plugin: elymentsPlugin });
  },
};

export default plugin;
