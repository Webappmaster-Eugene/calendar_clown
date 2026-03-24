import { useEffect, useCallback, type ReactNode } from "react";
import { useNavigate, useLocation } from "react-router";
import { useTelegram } from "../../hooks/useTelegram";

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { webApp } = useTelegram();

  const isRoot = location.pathname === "/";

  const handleBack = useCallback(() => {
    navigate(-1);
  }, [navigate]);

  useEffect(() => {
    if (!webApp) return;

    if (isRoot) {
      webApp.BackButton.hide();
    } else {
      webApp.BackButton.show();
      webApp.BackButton.onClick(handleBack);
    }

    return () => {
      webApp.BackButton.offClick(handleBack);
    };
  }, [webApp, isRoot, handleBack]);

  return <div className="app-shell">{children}</div>;
}
