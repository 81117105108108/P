/**
 * Caveman — bundled first-party plugin (ADR 0207).
 *
 * No host privileges. Registers a command + skill that teach the model
 * ultra-compressed output: fragments OK, anchors + code + next step, no
 * filler. Body loads on demand via the Skill tool, so idle cost is zero.
 */
export async function onLoad() {
  await pi.commands.register({
    id: "caveman",
    title: "Caveman: toggle terse mode",
    keywords: ["caveman", "terse", "tokens"],
    run: async () => {
      await pi.ui.openPanel({ title: "Caveman" });
    },
  });
}

export async function onUnload() {
  await pi.commands.unregister("caveman");
}
