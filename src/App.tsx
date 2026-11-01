import { lazy, Suspense } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router";
import { AuthProvider, useAuth } from "./features/auth/AuthProvider";
import { LoginPage } from "./features/auth/LoginPage";
import { RegistrationPage } from "./features/auth/RegistrationPage";
import { ConfirmEmailPage } from "./features/auth/ConfirmEmailPage";
import { ResendEmailPage } from "./features/auth/ResendEmailPage";
import { NotebookProvider } from "./app/NotebookProvider";
import { AppShell } from "./app/AppShell";
import { useLanguageContext } from "./context/LanguageProvider";
const SharedStatementPage = lazy(() =>
  import("./features/sharing/SharedStatementPage").then((module) => ({
    default: module.SharedStatementPage,
  })),
);
function SharedRoute() {
  const { t } = useLanguageContext();
  return (
    <Suspense fallback={<div className="app-splash">{t("অপেক্ষা করুন…")}</div>}>
      <SharedStatementPage />
    </Suspense>
  );
}
function AccountNotebook() {
  const auth = useAuth();
  const location = useLocation();
  const { t } = useLanguageContext();
  if (auth.status === "loading")
    return (
      <div className="app-splash">
        <div className="loading-orbit" />
        <h2>{t("নিজের খাতা খুলছে…")}</h2>
      </div>
    );
  if (!auth.user)
    return (
      <Navigate
        to="/login"
        state={{ from: location.pathname + location.search }}
        replace
      />
    );
  return (
    <NotebookProvider key={auth.user.id} mode="real">
      <AppShell />
    </NotebookProvider>
  );
}
function Login() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from;
  const target =
    typeof from === "string" &&
    from.startsWith("/") &&
    !from.startsWith("//") &&
    !/[\\\x00-\x1f]/.test(from) &&
    !["/login", "/register", "/auth/confirm"].some(
      (path) => from.split(/[?#]/)[0] === path,
    )
      ? from
      : "/";
  if (auth.user) return <Navigate to={target} replace />;
  return <LoginPage onSuccess={() => navigate(target, { replace: true })} />;
}
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/shared" element={<SharedRoute />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<RegistrationPage />} />
          <Route path="/register/resend" element={<ResendEmailPage />} />
          <Route path="/auth/confirm" element={<ConfirmEmailPage />} />
          <Route
            path="/sample/*"
            element={
              <NotebookProvider mode="demo">
                <AppShell />
              </NotebookProvider>
            }
          />
          <Route path="/*" element={<AccountNotebook />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
