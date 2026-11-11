import { FormEvent, useState } from "react";
import { openUrl } from "./lib/desktop";
import {
  ArrowRight,
  CheckCircle2,
  KeyRound,
} from "lucide-react";
import {
  activateLifetimeLicense,
} from "./lib/license";
import "./AuthScreen.css";

type LicenseActivationScreenProps = {
  onLicenseActivated: () => void;
};

function formatLicenseError(message: string) {
  const lower = message.toLowerCase();

  if (
    lower.includes("already active on another installation") ||
    lower.includes("already activated")
  ) {
    return "This key is already activated on another computer. Contact Snip Store support if you need to move it.";
  }

  if (
      lower.includes("not found") ||
    lower.includes("invalid license") ||
      lower.includes("invalid key") ||
      lower.includes("could not activate snip ai")
  ) {
    return "This license key is invalid. Please check the key and try again.";
  }

  if (lower.includes("revoked")) {
    return "This license key has been revoked. Please use another valid key.";
  }

  return message || "License activation failed. Please try again.";
}

export default function LicenseActivationScreen({
  onLicenseActivated,
}: LicenseActivationScreenProps) {
  const [licenseKey, setLicenseKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function activate(event: FormEvent) {
    event.preventDefault();

    setError("");
    setMessage("");

    const cleanKey =
      licenseKey.trim().toUpperCase();

    if (!cleanKey) {
      setError("Please enter your lifetime license key.");
      return;
    }

    setLoading(true);

    try {
      await activateLifetimeLicense(cleanKey);

      setMessage(
        "Lifetime access activated successfully.",
      );

      onLicenseActivated();
    } catch (err) {
      setError(
        formatLicenseError(
          err instanceof Error
            ? err.message
            : "License activation failed.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  async function openLicenseWebsite() {
    const url =
      import.meta.env.VITE_LICENSE_WEBSITE_URL ||
      "https://sinpai1.netlify.app/get-key.html";

    try {
      await openUrl(url);
    } catch (error) {
      console.error(
        "Failed to open license website:",
        error,
      );
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-ambient auth-ambient-one" />
      <div className="auth-ambient auth-ambient-two" />

      <div className="auth-card">
        <div className="auth-brand">
          <div className="auth-logo"><img src="./snip-logo-mark.png" alt="Snip AI" style={{width:"100%",height:"100%",objectFit:"contain",borderRadius:16}} /></div>

          <div>
            <strong>
              Snip <b>AI</b>
            </strong>
            <span>AI clipping workspace</span>
          </div>
        </div>

        <div className="auth-heading">
          <span className="auth-eyebrow">
            LIFETIME ACCESS
          </span>

          <h1>
            Activate your lifetime access.
          </h1>

          <p>
            Enter the activation key you received from Snip Store. Activate once on this computer, then use Snip AI offline.
          </p>
        </div>

        <form
          className="auth-form"
          onSubmit={activate}
        >
          <label className="auth-field">
            <span>Lifetime license key</span>

            <div className="auth-input-wrap">
              <KeyRound size={17} />

              <input
                value={licenseKey}
                onChange={(event) =>
                  setLicenseKey(
                    event.target.value.toUpperCase(),
                  )
                }
                autoCapitalize="characters"
                autoComplete="off"
                placeholder="SNIP-AI-XXXXX-XXXXX-XXXXX"
                autoFocus
              />
            </div>
          </label>

          {error && (
            <div className="auth-message auth-error">
              {error}
            </div>
          )}

          {message && (
            <div className="auth-message auth-success">
              <CheckCircle2 size={16} />
              <span>{message}</span>
            </div>
          )}

          <button
            className="auth-submit"
            disabled={loading}
            type="submit"
          >
            {loading
              ? "Activating..."
              : "Activate Lifetime Access"}
            <ArrowRight size={17} />
          </button>

          <button
            type="button"
            className="license-link"
            onClick={openLicenseWebsite}
            disabled={loading}
          >
            <KeyRound size={15} />
            Don't have a key? Get Lifetime Access — ₹100
          </button>
        </form>

        <div className="auth-footer">
          <span className="auth-footer-dot" />
          Lifetime access · one-time activation
        </div>
      </div>
    </div>
  );
}
