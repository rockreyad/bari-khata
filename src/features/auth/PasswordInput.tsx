import { useState, type InputHTMLAttributes } from "react";
import { Eye, EyeSlash, LockKey } from "@phosphor-icons/react";
import { useLanguageContext } from "../../context/LanguageProvider";
import "./registration.css";
export function PasswordInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false);
  const { t } = useLanguageContext();
  return (
    <div className="auth-input auth-password-input">
      <LockKey size={20} />
      <input {...props} type={visible ? "text" : "password"} />
      <button
        type="button"
        className="auth-password-toggle"
        aria-label={t(visible ? "পাসওয়ার্ড লুকাই" : "পাসওয়ার্ড দেখি")}
        aria-pressed={visible}
        onClick={() => setVisible((value) => !value)}
      >
        {visible ? <EyeSlash size={19} /> : <Eye size={19} />}
      </button>
    </div>
  );
}
