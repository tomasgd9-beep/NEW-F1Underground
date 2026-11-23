"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { saveEmailPrefs } from "@/app/actions";
import { EMAIL_KINDS, KIND_INFO, type Prefs } from "@/lib/email-kinds";

export function EmailSettings({ prefs, isCommissioner }: { prefs: Prefs; isCommissioner: boolean }) {
  const [allOff, setAllOff] = useState(prefs.allOff);
  return (
    <ActionForm action={saveEmailPrefs} className="grid gap-3">
      <label className="flex items-start gap-2 rounded border border-line p-2">
        <input type="checkbox" name="allOff" defaultChecked={prefs.allOff} onChange={(e) => setAllOff(e.target.checked)} className="mt-1" />
        <span>
          <b className="text-sm">No emails</b>
          <span className="block text-xs text-muted">Turns everything below off. Your choices below are kept for when you turn it back on.</span>
        </span>
      </label>
      <fieldset disabled={allOff} className={`grid gap-2 ${allOff ? "opacity-40" : ""}`}>
        {EMAIL_KINDS.filter((k) => isCommissioner || !KIND_INFO[k].commissionerOnly).map((k) => (
          <label key={k} className="flex items-start gap-2">
            <input type="checkbox" name={k} defaultChecked={prefs[k]} className="mt-1" />
            <span>
              <b className="text-sm">{KIND_INFO[k].label}</b>
              <span className="block text-xs text-muted">{KIND_INFO[k].note}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {/* Keep a commissioner-only choice as it was when the box isn't shown. */}
      {!isCommissioner && <input type="hidden" name="commissioner" value={prefs.commissioner ? "on" : ""} />}
      <div>
        <SubmitButton>Save</SubmitButton>
      </div>
    </ActionForm>
  );
}
