/**
 * Model pins offered by the subagent create/edit sheet.
 *
 * A definition stores `vendorKey-or-name/modelId` (or nothing, to inherit the
 * session). The sheet lists the same configured, runnable models as the
 * Composer rather than asking the user to type that string.
 */
import { modelIdsMatch, type ProviderPublic } from "@pi-desktop/shared";
import { defaultModelOptions } from "./default-model";

export type SubagentModelChoice = {
  /** Frontmatter `model:` value. */
  value: string;
  modelId: string;
  providerId: string;
  providerName: string;
  vendorKey: string;
};

export type SubagentModelChoiceGroup = {
  providerId: string;
  providerName: string;
  choices: SubagentModelChoice[];
};

/** True when the Composer would offer this provider's configured models. */
export function isSubagentModelProvider(provider: ProviderPublic): boolean {
  return (
    provider.enabled &&
    (provider.hasSecret || Boolean(provider.hasOauth) || provider.authKind === "none")
  );
}

/**
 * The pin a definition writes for one configured model.
 *
 * Stored provider ids are UUIDs, so the document uses the vendor key a person
 * would type (`anthropic/…`) and falls back to the display name for a custom
 * endpoint that has no vendor key.
 */
export function subagentModelPin(
  provider: Pick<ProviderPublic, "vendorKey" | "name">,
  modelId: string,
): string {
  const providerPart = provider.vendorKey.trim() || provider.name.trim();
  return `${providerPart}/${modelId}`;
}

function providerAlias(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function pinParts(pin: string): { providerPart: string; modelId: string } | null {
  const trimmed = pin.trim();
  const slash = trimmed.indexOf("/");
  if (slash < 1 || slash === trimmed.length - 1) return null;
  return {
    providerPart: trimmed.slice(0, slash),
    modelId: trimmed.slice(slash + 1),
  };
}

export function pinMatchesChoice(pin: string, choice: SubagentModelChoice): boolean {
  const parts = pinParts(pin);
  if (!parts) return false;
  if (!modelIdsMatch(parts.modelId, choice.modelId)) return false;
  if (parts.providerPart === choice.providerId) return true;
  const alias = providerAlias(parts.providerPart);
  return (
    providerAlias(choice.vendorKey) === alias ||
    providerAlias(choice.providerName) === alias
  );
}

/** Configured models the sheet can pin, in provider order, unique by pin. */
export function subagentModelChoices(
  providers: readonly ProviderPublic[],
): SubagentModelChoice[] {
  const seen = new Set<string>();
  const choices: SubagentModelChoice[] = [];
  for (const { provider, modelId } of defaultModelOptions(
    providers.filter(isSubagentModelProvider),
  )) {
    const value = subagentModelPin(provider, modelId);
    if (seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    choices.push({
      value,
      modelId,
      providerId: provider.id,
      providerName: provider.name,
      vendorKey: provider.vendorKey,
    });
  }
  return choices;
}

export function groupSubagentModelChoices(
  choices: readonly SubagentModelChoice[],
): SubagentModelChoiceGroup[] {
  const groups: SubagentModelChoiceGroup[] = [];
  for (const choice of choices) {
    const last = groups[groups.length - 1];
    if (last && last.providerId === choice.providerId) last.choices.push(choice);
    else {
      groups.push({
        providerId: choice.providerId,
        providerName: choice.providerName,
        choices: [choice],
      });
    }
  }
  return groups;
}

/**
 * Value the native select should hold for a draft pin. A pin written with the
 * display name still highlights the vendor-key option, so the list does not
 * grow a duplicate row for the same model.
 */
export function subagentModelSelectValue(
  pin: string,
  choices: readonly SubagentModelChoice[],
): string {
  const trimmed = pin.trim();
  if (!trimmed) return "";
  const match = choices.find((choice) => pinMatchesChoice(trimmed, choice));
  return match?.value ?? trimmed;
}

/**
 * A pin that is not in the configured list, so the select must keep it as an
 * extra option instead of snapping to inherit on edit.
 */
export function subagentModelOrphanPin(
  pin: string,
  choices: readonly SubagentModelChoice[],
): string | null {
  const trimmed = pin.trim();
  if (!trimmed) return null;
  if (choices.some((choice) => pinMatchesChoice(trimmed, choice))) return null;
  return trimmed;
}
