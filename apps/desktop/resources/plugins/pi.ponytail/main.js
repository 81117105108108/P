/**
 * Ponytail — bundled first-party plugin (ADR 0207).
 *
 * No host privileges. Teaches parallel fan-out: batch independent searches
 * in one message, converge on path:line anchors, delegate sweeps to a cheap
 * local subagent when the hit set is wide.
 */
export async function onLoad() {
  await pi.commands.register({
    id: "ponytail",
    title: "Ponytail: parallel sweep",
    keywords: ["ponytail", "parallel", "sweep"],
    run: async () => {
      await pi.ui.openPanel({ title: "Ponytail" });
    },
  });
}

export async function onUnload() {
  await pi.commands.unregister("ponytail");
}
