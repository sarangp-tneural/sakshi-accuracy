import { Component, type ReactNode } from "react";

export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="center-card card" role="alert">
        <h2>Something went wrong</h2>
        <p className="muted">{this.state.error.message}</p>
        <button className="btn primary" onClick={() => location.reload()}>Reload</button>
      </div>
    );
  }
}
