import { Component, type ErrorInfo, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';

interface Props { children: ReactNode; }
interface State { error: Error | null; }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Panel crashed', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div role="alert" className="rounded-2xl border border-red-500/30 bg-red-500/5 p-8 text-center">
          <TriangleAlert className="mx-auto mb-3 h-8 w-8 text-red-400" />
          <p className="mb-1 text-sm font-semibold text-red-300">This panel hit a snag</p>
          <p className="text-xs text-zinc-500">{this.state.error.message}</p>
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-4 rounded-lg border border-zinc-700 px-4 py-2 text-xs font-semibold text-zinc-200 transition-colors hover:bg-zinc-800"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
