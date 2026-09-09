import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DEFAULT_SUBAGENT_TOOLS,
  GLOBAL_SCOPE,
  MAX_SUBAGENT_MAX_TURNS,
  SUBAGENT_ASSIGNABLE_TOOLS,
  SUBAGENT_PRESETS,
  THINKING_LEVELS,
  isSubagentMutatingTool,
  resolveScope,
  type ActivationScope,
  type ProviderPublic,
  type SubagentPreset,
  type ThinkingLevel,
  type UserSubagentRecord,
} from "@pi-desktop/shared";
import { api } from "../../lib/api";
import { Button, Field, Input, Select, Textarea, cx } from "../ui";
import { IconFolderOpen, IconSparkles, IconX } from "../icons";

/** Hard cap host-core enforces on a definition document. */
export const MAX_SUBAGENT_BYTES = 32 * 1024;

export type SubagentDraft = {
  id: string;
  name: string;
  description: string;
  /** Tool grant; never empty, because a delegate with no tools cannot work. */
  tools: string[];
  /** `<provider>/<model>`, or empty for "same model as this session". */
  model: string;
  /** Empty means "whatever the session uses". */
  thinkingLevel: ThinkingLevel | "";
  /** `0` means no limit, which is what a definition without `maxTurns` gets. */
  maxTurns: number;
  body: string;
  enabled: boolean;
  scope: ActivationScope;
};

/**
 * The starter document. A subagent's body is its whole system prompt, so the
 * template is written as instructions to the delegate rather than as notes about
 * it — the difference between the two is the most common way a definition ends
 * up not working.
 */
export function subagentTemplate(name: string): string {
  const title = name.trim() || "this delegate";
  return `You are ${title}, working on one task for another agent.

## What to do
Describe the job in the imperative: what to look at, in what order, when to stop.

## What to report back
Say exactly what the answer should look like — the parent agent only sees your
final message, not your steps.

## Limits
Anything you must not do.
`;
}

/** A "blank" starter so users who ignore the preset grid are not stuck. */
export const BLANK_SUBAGENT_PRESET_ID = "" as const;

export function emptySubagentDraft(): SubagentDraft {
  return {
    id: "",
    name: "",
    description: "",
    tools: [...DEFAULT_SUBAGENT_TOOLS],
    model: "",
    thinkingLevel: "",
    maxTurns: 0,
    body: "",
    enabled: true,
    scope: GLOBAL_SCOPE,
  };
}

export function draftFromRecord(record: UserSubagentRecord, body: string): SubagentDraft {
  return {
    id: record.id,
    name: record.name,
    description: record.description ?? "",
    tools: record.tools.length ? [...record.tools] : [...DEFAULT_SUBAGENT_TOOLS],
    model: record.model ?? "",
    thinkingLevel: record.thinkingLevel ?? "",
    maxTurns: record.maxTurns ?? 0,
    body,
    enabled: record.enabled,
    scope: resolveScope(record.scope),
  };
}

/** Mirror of host-core's `normalize_name`, so the handle shown is the one stored. */
export function subagentSlug(value: string): string {
  let slug = "";
  let lastDash = false;
  for (const char of value.trim().toLocaleLowerCase()) {
    if (/[a-z0-9]/.test(char)) {
      slug += char;
      lastDash = false;
    } else if (slug && !lastDash) {
      slug += "-";
      lastDash = true;
    }
  }
  return slug.slice(0, 40).replace(/-+$/, "");
}

/**
 * Apply a built-in preset to a draft. Tool grants are replaced wholesale so a
 * preset that drops `Bash` truly drops it; `maxTurns` keeps its "0 means
 * unlimited" convention. Body and description are overwritten — these are the
 * values that make the preset worth picking.
 */
export function applySubagentPreset(draft: SubagentDraft, preset: SubagentPreset): SubagentDraft {
  return {
    ...draft,
    name: preset.name,
    description: preset.description,
    tools: [...preset.tools],
    maxTurns: preset.maxTurns,
    body: preset.body,
  };
}

/**
 * Split a `<provider>/<model>` pin into its halves. `openrouter` style ids may
 * themselves include a slash, so the model side is "everything after the first
 * slash" rather than "the last segment". A bare value with no slash is kept as
 * a model id with an empty provider for the picker to show as "custom".
 */
export function splitModelPin(value: string): { providerId: string; modelId: string } {
  const trimmed = value.trim();
  if (!trimmed) return { providerId: "", modelId: "" };
  const slash = trimmed.indexOf("/");
  if (slash <= 0) return { providerId: "", modelId: trimmed };
  return {
    providerId: trimmed.slice(0, slash),
    modelId: trimmed.slice(slash + 1),
  };
}

/** Returns an i18n key for the first problem, or null when the draft can save. */
export function subagentDraftError(draft: SubagentDraft): string | null {
  if (!draft.name.trim()) return "extensions.subagents.errorName";
  if (!subagentSlug(draft.name)) return "extensions.subagents.errorSlug";
  if (!draft.description.trim()) return "extensions.subagents.errorDescription";
  if (draft.tools.length === 0) return "extensions.subagents.errorTools";
  // `provider/model` is the only shape main can resolve; a bare model id has no
  // provider to look up, so it would be dropped with a diagnostic nobody reads.
  if (draft.model.trim() && !/^[^/\s]+\/.+$/.test(draft.model.trim())) {
    return "extensions.subagents.errorModel";
  }
  // 0 is the cleared state, not an invalid one: a definition may leave the turn
  // limit out entirely, and Settings must be able to express that too.
  if (
    !Number.isInteger(draft.maxTurns) ||
    draft.maxTurns < 0 ||
    draft.maxTurns > MAX_SUBAGENT_MAX_TURNS
  ) {
    return "extensions.subagents.errorMaxTurns";
  }
  if (!draft.body.trim()) return "extensions.subagents.errorBody";
  if (new TextEncoder().encode(draft.body).length > MAX_SUBAGENT_BYTES) {
    return "extensions.subagents.errorTooBig";
  }
  return null;
}

/**
 * One subagent preset shown as a chip in the "start from template" row.
 * Selecting one replaces the draft's name, description, tools, body and
 * maxTurns; the model and scope are left alone so the user's other choices
 * survive a reroll.
 */
function PresetChip({
  preset,
  selected,
  onSelect,
  nameLabel,
  descriptionLabel,
  applyLabel,
}: {
  preset: SubagentPreset;
  selected: boolean;
  onSelect: () => void;
  nameLabel: string;
  descriptionLabel: string;
  applyLabel: string;
}) {
  return (
    <button
      type="button"
      className={cx("ext-preset-chip", selected && "is-selected")}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="ext-preset-chip-head">
        <IconSparkles size={13} />
        <span className="ext-preset-chip-name">{nameLabel}</span>
      </span>
      <span className="ext-preset-chip-desc">{descriptionLabel}</span>
      <span className="ext-preset-chip-cta">{applyLabel}</span>
    </button>
  );
}

/**
 * The "start from template" grid shown above the form when creating a new
 * subagent. A blank chip sits alongside the built-ins so users who want a
 * clean slate are not forced into a preset. The grid is hidden entirely on
 * edit — a draft that has already been saved owns its body.
 */
function PresetPicker({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (presetId: string) => void;
}) {
  const { t } = useTranslation();
  const blankSelected = selectedId === BLANK_SUBAGENT_PRESET_ID;
  return (
    <div className="ext-field-group">
      <div className="ext-field-label ext-field-label-row">
        <span>{t("extensions.subagents.presetLabel")}</span>
      </div>
      <p className="ext-field-hint">{t("extensions.subagents.presetHint")}</p>
      <div className="ext-preset-pick" role="group" aria-label={t("extensions.subagents.presetLabel")}>
        {SUBAGENT_PRESETS.map((preset) => (
          <PresetChip
            key={preset.id}
            preset={preset}
            selected={selectedId === preset.id}
            onSelect={() => onSelect(preset.id)}
            nameLabel={t(`extensions.subagents.preset${capitalize(preset.id)}Name`)}
            descriptionLabel={t(`extensions.subagents.preset${capitalize(preset.id)}Desc`)}
            applyLabel={t("extensions.subagents.presetApply")}
          />
        ))}
        <PresetChip
          preset={{
            id: BLANK_SUBAGENT_PRESET_ID as SubagentPreset["id"],
            name: t("extensions.subagents.presetBlank"),
            description: "",
            tools: [...DEFAULT_SUBAGENT_TOOLS],
            maxTurns: 0,
            body: "",
          }}
          selected={blankSelected}
          onSelect={() => onSelect(BLANK_SUBAGENT_PRESET_ID)}
          nameLabel={t("extensions.subagents.presetBlank")}
          descriptionLabel={t("extensions.subagents.presetBlankDesc")}
          applyLabel={t("extensions.subagents.presetApply")}
        />
      </div>
    </div>
  );
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Model picker for a subagent draft.
 *
 * Three modes, in shadowing order:
 *  - "inherit": the picker is empty and the delegate uses the session model.
 *  - "configured": the picker lists the providers whose models are flagged
 *    `availableForSubagents` in Settings, grouped by provider. Choosing one
 *    writes the draft's `model` field as `<providerId>/<modelId>`.
 *  - "custom": a free-form input that accepts any `provider/model` string.
 *    Custom is reachable both as a top-level "Custom..." entry (so users with
 *    one configured provider can still pin a different model) and as the
 *    fallback when no providers are configured at all.
 *
 * The draft's `model` field is the source of truth; this component only maps
 * it back to a picker state when the user opens the sheet.
 */
function ModelField({
  draft,
  setDraft,
  providers,
  loading,
}: {
  draft: SubagentDraft;
  setDraft: (next: SubagentDraft) => void;
  providers: readonly ProviderPublic[];
  loading: boolean;
}) {
  const { t } = useTranslation();
  const split = splitModelPin(draft.model);
  // A custom id is anything the picker cannot represent: empty provider (bare
  // model id), an unknown provider, or a model id not flagged for subagents.
  const options = useMemo(() => {
    const flat: { provider: ProviderPublic; binding: ProviderPublic["models"][number] }[] = [];
    for (const provider of providers) {
      for (const binding of provider.models) {
        if (binding.availableForSubagents) {
          flat.push({ provider, binding });
        }
      }
    }
    flat.sort((a, b) => {
      const providerOrder = a.provider.name.localeCompare(b.provider.name);
      if (providerOrder !== 0) return providerOrder;
      return a.binding.id.localeCompare(b.binding.id);
    });
    return flat;
  }, [providers]);

  const matched = useMemo(() => {
    if (!split.providerId || !split.modelId) return null;
    return options.find(
      (option) =>
        option.provider.id === split.providerId &&
        option.binding.id === split.modelId,
    );
  }, [options, split.providerId, split.modelId]);

  const mode: "inherit" | "configured" | "custom" = !draft.model.trim()
    ? "inherit"
    : matched
      ? "configured"
      : "custom";

  const setMode = (next: "inherit" | "configured" | "custom") => {
    if (next === "inherit") setDraft({ ...draft, model: "" });
    else if (next === "custom") setDraft({ ...draft, model: "" });
  };

  const pickConfigured = (providerId: string, modelId: string) => {
    setDraft({ ...draft, model: `${providerId}/${modelId}` });
  };

  if (options.length === 0 && !loading) {
    // No provider offers a model for subagents yet. Keep a single text input so
    // the user is not stuck; the empty hint directs them to Models.
    return (
      <Field
        label={t("extensions.subagents.model")}
        hint={
          loading
            ? t("extensions.subagents.modelPickHint")
            : t("extensions.subagents.modelPickEmpty")
        }
      >
        <Input
          value={draft.model}
          placeholder={t("extensions.subagents.modelPlaceholder")}
          onChange={(event) => setDraft({ ...draft, model: event.target.value })}
        />
      </Field>
    );
  }

  // Custom value rendered as an Input so the user can finish typing it; once it
  // matches a configured option the parent draft moves to "configured" mode.
  const showCustom = mode === "custom";

  return (
    <>
      <div className="ext-field-pair">
      <Field
        label={t("extensions.subagents.model")}
        hint={t("extensions.subagents.modelPickHint")}
      >
        <Select
          value={
            mode === "inherit"
              ? "__inherit__"
              : mode === "custom"
                ? "__custom__"
                : `${split.providerId}/${split.modelId}`
          }
          onChange={(event) => {
            const value = event.target.value;
            if (value === "__inherit__") {
              setMode("inherit");
            } else if (value === "__custom__") {
              setMode("custom");
            } else {
              const [providerId, modelId] = value.split("/", 2);
              pickConfigured(providerId, modelId);
            }
          }}
        >
          <option value="__inherit__">{t("extensions.subagents.modelInherit")}</option>
          {options.map((option) => (
            <option
              key={`${option.provider.id}/${option.binding.id}`}
              value={`${option.provider.id}/${option.binding.id}`}
            >
              {t("extensions.subagents.modelPickGroup", {
                provider: option.provider.name,
              })}{" "}
— {option.binding.id}
            </option>
          ))}
          <option value="__custom__">{t("extensions.subagents.modelPickCustom")}</option>
        </Select>
      </Field>
      <Field
        label={t("extensions.subagents.thinking")}
        hint={t("extensions.subagents.thinkingHint")}
      >
        <Select
          value={draft.thinkingLevel}
          onChange={(event) =>
            setDraft({ ...draft, thinkingLevel: event.target.value as ThinkingLevel | "" })
          }
        >
          <option value="">{t("extensions.subagents.thinkingInherit")}</option>
          {THINKING_LEVELS.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </Select>
      </Field>
    </div>
      {showCustom ? (
        <Field
          label={t("extensions.subagents.modelPickCustom")}
          hint={t("extensions.subagents.modelPickCustomHint")}
        >
          <Input
            value={draft.model}
            placeholder={t("extensions.subagents.modelPlaceholder")}
            onChange={(event) => setDraft({ ...draft, model: event.target.value })}
          />
        </Field>
      ) : null}
    </>
  );
}

/**
 * Subagents are global-only (D202), so there is no level to choose: this states
 * where the document lands and leaves only the active decision.
 */
function ManagementScope({
  draft,
  setDraft,
}: {
  draft: SubagentDraft;
  setDraft: (next: SubagentDraft) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="agent-mcp-scope">
      <div className="agent-mcp-scope-copy">
        <span className="agent-mcp-scope-label">{t("settings.globalScope")}</span>
        <span className="agent-mcp-scope-hint">{t("settings.subagentsOnlyGlobal")}</span>
      </div>
      <button
        type="button"
        className={cx("settings-toggle", draft.enabled && "on")}
        role="switch"
        aria-checked={draft.enabled}
        aria-label={t("settings.enableCapability", { name: draft.name || draft.id })}
        onClick={() => setDraft({ ...draft, enabled: !draft.enabled })}
      >
        <span className="settings-toggle-thumb" />
      </button>
    </div>
  );
}

/**
 * Create/edit sheet for one subagent definition.
 *
 * The tool grant sits above the prompt because it is the only field with a
 * safety consequence: a delegate that declares `Bash`, `Edit` or `Write` can
 * change the workspace on its own (ADR 0062), and a checkbox group makes that
 * choice explicit instead of hiding it in frontmatter the user has to remember
 * to write.
 */
export function SubagentEditorSheet({
  draft,
  setDraft,
  editing,
  saving,
  onClose,
  onSave,
  onReveal,
}: {
  draft: SubagentDraft;
  setDraft: (next: SubagentDraft) => void;
  editing: UserSubagentRecord | null;
  saving: boolean;
  onClose: () => void;
  onSave: () => void;
  onReveal?: () => void;
}) {
  const { t } = useTranslation();
  const [nameTouched, setNameTouched] = useState(!!editing);
  const [presetId, setPresetId] = useState<string | null>(BLANK_SUBAGENT_PRESET_ID);
  const [providers, setProviders] = useState<ProviderPublic[]>([]);
  const [providersLoading, setProvidersLoading] = useState(true);
  const errorKey = subagentDraftError(draft);
  const pristine = !editing && !draft.name.trim() && !draft.description.trim();
  const bytes = new TextEncoder().encode(draft.body).length;
  const slug = draft.id || subagentSlug(draft.name);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saving, onClose]);

  // Pull the configured providers once. The picker only needs the
  // availability flag, but reading the full list keeps the cache warm for the
  // rest of the page; a failure here falls back to a free-text input.
  useEffect(() => {
    let cancelled = false;
    setProvidersLoading(true);
    api
      .listProviders()
      .then((result) => {
        if (cancelled) return;
        setProviders(result.providers ?? []);
      })
      .catch(() => {
        if (cancelled) return;
        setProviders([]);
      })
      .finally(() => {
        if (cancelled) return;
        setProvidersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const set = <K extends keyof SubagentDraft>(key: K, value: SubagentDraft[K]) =>
    setDraft({ ...draft, [key]: value });

  // Naming a new delegate seeds the body once, so the editor is never a blank
  // page but never overwrites something the user has started writing either.
  const setName = (value: string) => {
    const next: SubagentDraft = { ...draft, name: value };
    if (!nameTouched && !editing && !draft.body.trim()) {
      next.body = subagentTemplate(value);
    }
    setDraft(next);
  };

  const toggleTool = (tool: string, on: boolean) =>
    set(
      "tools",
      on
        ? // Keep the canonical order, so the document reads the same however the
          // boxes were clicked.
          SUBAGENT_ASSIGNABLE_TOOLS.filter(
            (candidate) => candidate === tool || draft.tools.includes(candidate),
          )
        : draft.tools.filter((candidate) => candidate !== tool),
    );

  const applyPreset = (nextId: string) => {
    setPresetId(nextId);
    if (!nextId || nextId === BLANK_SUBAGENT_PRESET_ID) return;
    const preset = SUBAGENT_PRESETS.find((candidate) => candidate.id === nextId);
    if (!preset) return;
    setDraft(applySubagentPreset(draft, preset));
    setNameTouched(true);
  };

  return (
    <div
      className="overlay ext-sheet-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <div
        className="dialog ext-sheet"
        role="dialog"
        aria-modal
        aria-labelledby="subagent-sheet-title"
      >
        <div className="ext-sheet-head">
          <div>
            <h3 id="subagent-sheet-title" className="ext-sheet-title">
              {editing
                ? t("extensions.subagents.editTitle")
                : t("extensions.subagents.addTitle")}
            </h3>
            <p className="ext-sheet-sub">{t("extensions.subagents.sheetSubtitle")}</p>
          </div>
          <button
            type="button"
            className="ext-sheet-close"
            aria-label={t("common.close")}
            onClick={onClose}
          >
            <IconX size={14} />
          </button>
        </div>

        <div className="ext-sheet-body">
          {!editing ? (
            <PresetPicker selectedId={presetId} onSelect={applyPreset} />
          ) : null}

          <Field
            label={t("extensions.subagents.name")}
            hint={
              slug
                ? t("extensions.subagents.slugHint", { id: slug })
                : t("extensions.subagents.nameHint")
            }
          >
            <Input
              value={draft.name}
              autoFocus={!editing}
              placeholder={t("extensions.subagents.namePlaceholder")}
              onChange={(event) => {
                setNameTouched(true);
                setName(event.target.value);
              }}
            />
          </Field>

          <Field
            label={t("extensions.subagents.description")}
            hint={t("extensions.subagents.descriptionHint")}
          >
            <Textarea
              value={draft.description}
              rows={2}
              placeholder={t("extensions.subagents.descriptionPlaceholder")}
              onChange={(event) => set("description", event.target.value)}
            />
          </Field>

          <div className="ext-field-group">
            <div className="ext-field-label">{t("extensions.subagents.tools")}</div>
            <p className="ext-field-hint">{t("extensions.subagents.toolsHint")}</p>
            <div
              className="ext-tool-pick"
              role="group"
              aria-label={t("extensions.subagents.tools")}
            >
              {SUBAGENT_ASSIGNABLE_TOOLS.map((tool) => (
                <label
                  key={tool}
                  className={cx(
                    "ext-tool-opt",
                    draft.tools.includes(tool) && "is-on",
                    isSubagentMutatingTool(tool) && "is-mutating",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={draft.tools.includes(tool)}
                    onChange={(event) => toggleTool(tool, event.target.checked)}
                  />
                  <code>{tool}</code>
                </label>
              ))}
            </div>
            {draft.tools.some(isSubagentMutatingTool) ? (
              <p className="ext-field-hint">{t("extensions.subagents.mutatingHint")}</p>
            ) : null}
          </div>

          <ModelField
            draft={draft}
            setDraft={setDraft}
            providers={providers}
            loading={providersLoading}
          />

          <Field
            label={t("extensions.subagents.maxTurns")}
            hint={t("extensions.subagents.maxTurnsHint", { max: MAX_SUBAGENT_MAX_TURNS })}
          >
            <Input
              type="number"
              min={1}
              max={MAX_SUBAGENT_MAX_TURNS}
              placeholder={t("extensions.subagents.maxTurnsUnlimited")}
              value={draft.maxTurns > 0 ? String(draft.maxTurns) : ""}
              onChange={(event) =>
                set("maxTurns", Number.parseInt(event.target.value, 10) || 0)
              }
            />
          </Field>

          <div className="ext-field-group">
            <div className="ext-field-label ext-field-label-row">
              <span>{t("extensions.subagents.body")}</span>
              <span
                className={
                  bytes > MAX_SUBAGENT_BYTES
                    ? "ext-byte-count is-over"
                    : bytes > MAX_SUBAGENT_BYTES * 0.8
                      ? "ext-byte-count is-near"
                      : "ext-byte-count"
                }
              >
                {t("extensions.subagents.bytes", {
                  used: Math.round(bytes / 1024),
                  max: Math.round(MAX_SUBAGENT_BYTES / 1024),
                })}
              </span>
            </div>
            <p className="ext-field-hint">{t("extensions.subagents.bodyHint")}</p>
            <Textarea
              className="ext-skill-body"
              value={draft.body}
              rows={12}
              spellCheck={false}
              placeholder={subagentTemplate("")}
              aria-label={t("extensions.subagents.body")}
              onChange={(event) => set("body", event.target.value)}
            />
          </div>

          <div className="ext-field-group">
            <div className="ext-field-label">{t("settings.scope")}</div>
            <p className="ext-field-hint">{t("settings.scopeHint")}</p>
            <ManagementScope draft={draft} setDraft={setDraft} />
          </div>
</div>

        {errorKey && !pristine ? <p className="ext-sheet-error">{t(errorKey)}</p> : null}
        <div className="ext-sheet-actions">
          {editing && onReveal ? (
            <Button variant="ghost" onClick={onReveal}>
              <IconFolderOpen size={13} />
              {t("extensions.subagents.reveal")}
            </Button>
          ) : (
            <span className="ext-sheet-note">{t("extensions.subagents.sheetNote")}</span>
          )}
          <div className="ext-sheet-actions-end">
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              onClick={onSave}
              disabled={saving || !!errorKey}
              title={errorKey ? t(errorKey) : undefined}
            >
              {saving ? t("common.saving") : t("common.save")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}