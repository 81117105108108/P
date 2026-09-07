import { useTranslation } from "react-i18next";
import {
  KeyValueRows,
  type KeyValuePair,
} from "../extensions/KeyValueRows";

export function ProviderHeadersEditor({
  pairs,
  onChange,
}: {
  pairs: KeyValuePair[];
  onChange: (next: KeyValuePair[]) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="provider-setup-headers">
      <div className="provider-setup-headers-label">{t("settings.headers")}</div>
      <p className="provider-setup-headers-hint">{t("settings.headersHint")}</p>
      <KeyValueRows
        pairs={pairs}
        onChange={onChange}
        keyPlaceholder={t("settings.headerName")}
        valuePlaceholder={t("settings.headerValue")}
        addLabel={t("settings.addHeader")}
      />
    </div>
  );
}
