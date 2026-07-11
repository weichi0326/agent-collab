import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, Result } from 'antd';
import { clearProjectStorageData } from '../lib/tauriStorage';

// 顶层错误边界:任一子树抛错时兜底展示,避免整页白屏。
// 提供「重载页面」与「清空本地数据」两条自救路径(persist 反序列化损坏时后者可恢复)。
interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('未捕获的渲染错误:', error, info.componentStack);
  }

  private reload = () => window.location.reload();

  private resetLocal = async () => {
    try {
      await clearProjectStorageData();
      window.location.reload();
    } catch (error) {
      console.error('清空本地数据失败:', error);
      this.setState({
        error: new Error(
          `清空本地数据失败: ${error instanceof Error ? error.message : String(error)}`,
        ),
      });
    }
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <Result
        status="error"
        title="界面出错了"
        subTitle={error.message || '发生未知错误,可尝试重载页面。'}
        extra={[
          <Button type="primary" key="reload" onClick={this.reload}>
            重载页面
          </Button>,
          <Button danger key="reset" onClick={() => void this.resetLocal()}>
            清空本地数据并重载
          </Button>,
        ]}
      />
    );
  }
}

export default ErrorBoundary;
