import React from "react";
import ReactDOM from "react-dom/client";
import App from "@/App";
import "@/styles/theme.css";
import { readCachedTheme, applyTheme } from "@/lib/ipc";

applyTheme(readCachedTheme());

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { message: string | null }> {
  state = { message: null as string | null };
  static getDerivedStateFromError(err: unknown) {
    return { message: err instanceof Error ? err.message : "界面渲染出错" };
  }
  componentDidCatch(err: unknown) {
    console.error("渲染异常：", err);
  }
  render() {
    if (this.state.message) {
      return (
        <div className="flex h-full items-center justify-center p-10">
          <div className="glass rounded-2xl p-8 max-w-lg">
            <h1 className="text-lg font-semibold mb-2">界面暂时无法渲染</h1>
            <p className="text-sm text-muted mb-4">{this.state.message}</p>
            <button className="btn-primary" onClick={() => window.location.reload()}>重新加载</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
