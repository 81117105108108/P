import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AppSettings } from "@pi-desktop/shared";
import {
  MAX_READING_FONT_SIZE,
  MIN_READING_FONT_SIZE,
  normalizeReadingFontSize,
} from "@pi-desktop/shared";
import { Input, cx } from "../ui";

const PRESETS = [
  { size: 12, key: "settings.fontSizeSmall" },
  { size: 14, key: "settings.fontSizeDefault" },
  { size: 16, key: "settings.fontSizeLarge" },
  { size: 18, key: "settings.fontSizeXl" },
] as const;

/**
 * Reading font size (Settings → General → Appearance). Presets plus a custom
 * px field persist as `AppSettings.fontSize` and remap the `--text-*` ramp
 * inside the chat transcript and composer. Window zoom is unchanged.
 */
export function FontSizeRow({
  settings,
  saveSettings,
}: {
  settings: AppSettings;
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>;
}) {
  const { t } = useTranslation();
  const current = normalizeReadingFontSize(settings.fontSize);
  const [draft, setDraft] = useState(String(current));
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    setDraft(String(current));
  }, [current]);

  const commit = async (next: number) => {
    const size = normalizeReadingFontSize(next);
    setDraft(String(size));
    if (size === current) {
      setSaveError(false);
      return;
    }
    setSaveError(false);
    try {
      await saveSettings({ fontSize: size });
    } catch {
      setDraft(String(current));
      setSaveError(true);
    }
  };

  const commitDraft = async () => {
    const parsed = Number(draft.trim());
    const next =
      Number.isInteger(parsed) &&
      parsed >= MIN_READING_FONT_SIZE &&
      parsed <= MAX_READING_FONT_SIZE
        ? parsed
        : current;
    await commit(next);
  };

  return (
    <div className="settings-row">
      <div className="settings-row-copy">
        <div className="settings-row-title">{t("settings.fontSize")}</div>
        <div className="settings-row-desc">{t("settings.fontSizeDesc")}</div>
      </div>
      <div className="settings-row-control">
        <div className="settings-font-size">
          <div
            className="settings-segment"
            role="radiogroup"
            aria-label={t("settings.fontSize")}
          >
            {PRESETS.map((preset) => (
              <button
                key={preset.size}
                type="button"
                role="radio"
                aria-checked={current === preset.size}
                className={cx(
                  "settings-segment-item",
                  current === preset.size && "active",
                )}
                onClick={() => void commit(preset.size)}
              >
                {t(preset.key)}
              </button>
            ))}
          </div>
          <div className="settings-font-size-custom">
            <Input
              type="number"
              min={MIN_READING_FONT_SIZE}
              max={MAX_READING_FONT_SIZE}
              step={1}
              inputMode="numeric"
              value={draft}
              aria-label={t("settings.fontSizeCustom")}
              aria-invalid={saveError}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => void commitDraft()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
            />
            <span className="settings-font-size-suffix" aria-hidden>
              px
            </span>
          </div>
          {saveError ? (
            <span className="settings-command-shell-state error" role="status">
              {t("settings.fontSizeSaveError")}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
