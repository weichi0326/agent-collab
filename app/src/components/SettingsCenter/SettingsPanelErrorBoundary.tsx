import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, Result } from 'antd';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class SettingsPanelErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[settings-panel]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <Result
          status="error"
          title="此设置页加载失败"
          subTitle={this.state.error.message || '请重试，或返回工作台后重新打开设置。'}
          extra={(
            <Button type="primary" onClick={() => this.setState({ error: null })}>
              重试
            </Button>
          )}
        />
      );
    }
    return this.props.children;
  }
}
